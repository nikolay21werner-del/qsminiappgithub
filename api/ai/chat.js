/* =========================================================
   QUANTSIGNAL AI — /api/ai/chat (Vercel serverless function)
   Real, server-side OpenAI-compatible chat endpoint.

   Required env vars (configure in Vercel project settings):
     AI_API_KEY     — secret API key for the provider (NEVER exposed to FE).
                      May be omitted when AI_ALLOW_NO_KEY=true or
                      AI_AUTH_MODE=oidc (see below).
   Optional:
     AI_BASE_URL       — OpenAI-compatible base URL (default https://api.openai.com/v1)
                         For Vercel AI Gateway: https://ai-gateway.vercel.sh/v1
     AI_MODEL          — model id (default gpt-4o-mini). For the Vercel AI
                         Gateway use a fully-qualified slug like
                         "openai/gpt-4o-mini".
     AI_TIMEOUT_MS     — upstream request timeout (default 25000)
     AI_TEMPERATURE    — sampling temperature (default 0.2)
     AI_ALLOW_NO_KEY   — when "true"/"1"/"yes" (or AI_AUTH_MODE=none), the
                         endpoint is considered configured even with no
                         AI_API_KEY and NO Authorization header is sent
                         upstream. Use for public, no-auth providers
                         (e.g. https://gen.pollinations.ai/v1).
     AI_AUTH_MODE      — authentication strategy for the upstream call:
                           "bearer" (default) sends "Authorization: Bearer <AI_API_KEY>"
                           "none"   disables the Authorization header
                           "oidc"   uses Vercel AI Gateway with the
                                    AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN
                                    env var as the bearer token
     AI_PROVIDER       — alias for AI_AUTH_MODE. The value
                         "vercel-ai-gateway" is treated as "oidc".
     AI_GATEWAY_API_KEY — preferred bearer token for AI_AUTH_MODE=oidc.
     VERCEL_OIDC_TOKEN — fallback bearer token automatically injected by
                         Vercel for the deployment's OIDC identity. On
                         Vercel Functions the same token is also exposed
                         per-request as the `x-vercel-oidc-token` request
                         header; this endpoint uses that header as a final
                         fallback when neither env var is populated.

   This endpoint NEVER returns a synthetic "demo" answer.
   Default secure behavior: if AI_API_KEY is missing AND no-key mode is
   not explicitly enabled, respond 503 with error code "ai_not_configured".
   For AI_AUTH_MODE=oidc with no usable token the endpoint returns 503
   with error code "ai_oidc_unavailable".
   ========================================================= */

"use strict";

const SYSTEM_PROMPT_BASE = [
  "You are QUANTSIGNAL AI, a concise crypto-markets analyst integrated into a",
  "Telegram Mini App. You receive live market context (selected symbol, last",
  "price, 24h change, 24h volume, 24h high/low, connection status) and the",
  "user's recent conversation.",
  "",
  "Rules:",
  "- Respond in the user's language (en/ru/zh) matching `language_code`.",
  "- Ground every observation in the provided live context. If a field is",
  "  missing, say so plainly instead of inventing values.",
  "- Be objective and structured: trend, key levels, volatility/volume context,",
  "  invalidation, and what would change your view. Use short bullets.",
  "- NEVER claim to give financial advice. Always include a short risk caveat",
  "  at the end (one sentence) in the user's language.",
  "- Do not promise outcomes, do not use hype words, do not output emojis.",
  "- Keep replies under ~220 words."
].join("\n");

const RISK_CAVEAT = {
  en: "Educational analysis based on live market data — not financial advice. Manage risk.",
  ru: "Аналитика по живым рыночным данным — не является инвестиционной рекомендацией. Управляйте риском.",
  zh: "基于实时行情的研究性分析 — 不构成投资建议，请控制风险。"
};

function pickLang(code) {
  if (!code) return "en";
  const lc = String(code).toLowerCase();
  if (lc.indexOf("ru") === 0) return "ru";
  if (lc.indexOf("zh") === 0) return "zh";
  return "en";
}

function sanitizeStr(value, maxLen) {
  if (value == null) return "";
  let s = String(value);
  // Strip ASCII control chars except \n (0x0A) and \t (0x09).
  s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

function sanitizeSymbol(sym) {
  if (!sym) return "";
  return String(sym).toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 20);
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMarketContext(ctx, lang) {
  if (!ctx || typeof ctx !== "object") return null;
  const symbol = sanitizeSymbol(ctx.symbol);
  if (!symbol) return null;
  const last = num(ctx.last_price);
  const change = num(ctx.change_pct_24h);
  const volume = num(ctx.volume_24h);
  const high = num(ctx.high_24h);
  const low = num(ctx.low_24h);
  const transport = sanitizeStr(ctx.transport, 16) || "unknown";
  const provider = sanitizeStr(ctx.provider, 64) || "Bybit V5 (linear)";
  const ageMs = num(ctx.last_update_age_ms);

  const lines = [
    "Symbol: " + symbol,
    "Last price: " + (last == null ? "n/a" : last),
    "24h change %: " + (change == null ? "n/a" : change.toFixed(3)),
    "24h volume (quote): " + (volume == null ? "n/a" : volume),
    "24h high: " + (high == null ? "n/a" : high),
    "24h low: " + (low == null ? "n/a" : low),
    "Connection: " + transport + " via " + provider +
      (ageMs != null ? " (last tick " + Math.round(ageMs) + "ms ago)" : "")
  ];

  if (Array.isArray(ctx.top_tickers) && ctx.top_tickers.length) {
    const peers = ctx.top_tickers.slice(0, 8).map(function (t) {
      const s = sanitizeSymbol(t && t.symbol);
      const p = num(t && t.last_price);
      const c = num(t && t.change_pct_24h);
      if (!s) return null;
      return s + " " + (p == null ? "n/a" : p) +
        " (" + (c == null ? "n/a" : c.toFixed(2) + "%") + ")";
    }).filter(Boolean);
    if (peers.length) lines.push("Peers: " + peers.join(", "));
  }

  return "## LIVE MARKET CONTEXT (language=" + lang + ")\n" + lines.join("\n");
}

function validateMessages(raw) {
  if (!Array.isArray(raw)) return { error: "messages_must_be_array" };
  if (raw.length === 0) return { error: "messages_empty" };
  if (raw.length > 24) raw = raw.slice(-24);

  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" || m.role === "system" ? m.role : "user";
    const content = sanitizeStr(m.content, 4000);
    if (!content) continue;
    out.push({ role: role, content: content });
  }
  if (!out.length) return { error: "messages_empty" };
  // Final message must come from the user — otherwise the model has nothing to answer.
  const last = out[out.length - 1];
  if (last.role !== "user") return { error: "last_message_not_user" };
  return { messages: out };
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error("payload_too_large"));
        try { req.destroy(); } catch (e) { /* ignore */ }
      }
    });
    req.on("end", function () {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return; }

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const providerAlias = String(process.env.AI_PROVIDER || "").toLowerCase();
  let authMode = String(process.env.AI_AUTH_MODE || "").toLowerCase();
  if (!authMode && providerAlias === "vercel-ai-gateway") authMode = "oidc";
  const allowNoKeyFlag = String(process.env.AI_ALLOW_NO_KEY || "").toLowerCase();
  const noKeyMode =
    authMode === "none" ||
    allowNoKeyFlag === "1" ||
    allowNoKeyFlag === "true" ||
    allowNoKeyFlag === "yes";
  const oidcMode = authMode === "oidc";
  // On Vercel Functions the deployment's OIDC token is injected per-request
  // as the `x-vercel-oidc-token` header (in addition to `VERCEL_OIDC_TOKEN`).
  // Accept that header as a final fallback so the endpoint works on Vercel
  // even when the env var is not surfaced to the function runtime.
  const headerOidcRaw =
    (req.headers && (req.headers["x-vercel-oidc-token"] ||
      req.headers["X-Vercel-Oidc-Token"])) || "";
  const headerOidc = Array.isArray(headerOidcRaw)
    ? String(headerOidcRaw[0] || "")
    : String(headerOidcRaw || "");
  const oidcToken =
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN ||
    headerOidc ||
    "";

  if (oidcMode && !oidcToken) {
    sendJson(res, 503, {
      error: "ai_oidc_unavailable",
      message:
        "AI_AUTH_MODE=oidc is set but no usable token was found: " +
        "AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, and the per-request " +
        "x-vercel-oidc-token header are all empty. Enable Vercel OIDC " +
        "for this project or provide AI_GATEWAY_API_KEY."
    });
    return;
  }

  if (!apiKey && !noKeyMode && !oidcMode) {
    sendJson(res, 503, {
      error: "ai_not_configured",
      message:
        "Server-side AI key (AI_API_KEY) is not configured. " +
        "Set AI_API_KEY in the deployment environment to enable live AI replies, " +
        "set AI_ALLOW_NO_KEY=true for a public no-auth OpenAI-compatible provider, " +
        "or set AI_AUTH_MODE=oidc to use the Vercel AI Gateway."
    });
    return;
  }

  let body;
  try { body = await readJson(req); }
  catch (e) { sendJson(res, 400, { error: e.message || "invalid_json" }); return; }

  const lang = pickLang(body && body.language_code);
  const validated = validateMessages(body && body.messages);
  if (validated.error) { sendJson(res, 400, { error: validated.error }); return; }

  const marketBlock = buildMarketContext(body && body.market_context, lang);
  // initData is accepted for future server-side validation but does not block
  // browser testing. We never log or echo it.
  const initData = sanitizeStr(
    (req.headers && req.headers["x-telegram-init-data"]) || (body && body.init_data),
    4096
  );
  void initData;

  const systemMessages = [{ role: "system", content: SYSTEM_PROMPT_BASE }];
  if (marketBlock) systemMessages.push({ role: "system", content: marketBlock });
  systemMessages.push({
    role: "system",
    content: 'Always end with this exact risk caveat on its own line: "' + RISK_CAVEAT[lang] + '"'
  });

  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const temperature = num(process.env.AI_TEMPERATURE);
  const timeoutMs = num(process.env.AI_TIMEOUT_MS) || 25000;

  const payload = {
    model: model,
    messages: systemMessages.concat(validated.messages),
    temperature: temperature == null ? 0.2 : temperature,
    max_tokens: 600
  };

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);

  const upstreamHeaders = { "Content-Type": "application/json" };
  if (oidcMode) {
    upstreamHeaders["Authorization"] = "Bearer " + oidcToken;
  } else if (apiKey && authMode !== "none" && !noKeyMode) {
    upstreamHeaders["Authorization"] = "Bearer " + apiKey;
  }

  let upstream;
  try {
    upstream = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === "AbortError";
    sendJson(res, 504, {
      error: aborted ? "ai_upstream_timeout" : "ai_upstream_unreachable",
      detail: aborted ? "Upstream provider did not respond in time." : "Could not reach upstream provider."
    });
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    let detail = null;
    try { detail = await upstream.text(); } catch (e) { /* ignore */ }
    sendJson(res, 502, {
      error: "ai_upstream_error",
      status: upstream.status,
      detail: detail ? String(detail).slice(0, 400) : null
    });
    return;
  }

  let data;
  try { data = await upstream.json(); }
  catch (e) { sendJson(res, 502, { error: "ai_upstream_bad_json" }); return; }

  const content =
    data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;

  if (!content) { sendJson(res, 502, { error: "ai_empty_response" }); return; }

  sendJson(res, 200, {
    content: String(content),
    model: (data && data.model) || model,
    ts: Date.now(),
    usage: (data && data.usage) || null
  });
};
