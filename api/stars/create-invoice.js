/* =========================================================
   QUANTSIGNAL AI — /api/stars/create-invoice
   Vercel serverless function that wraps Telegram Bot API
   `createInvoiceLink` for the in-app Crypto Combat boost
   packs paid in Telegram Stars (currency code "XTR").

   Required env vars (configure in Vercel project settings):
     TELEGRAM_BOT_TOKEN   — preferred name
     BOT_TOKEN            — accepted fallback name

   The endpoint NEVER hard-codes a token. If neither env var
   is present it returns a structured 503 error so the FE can
   show a clear non-paid fallback (no broken flow).

   Telegram Stars rules:
     - currency MUST be "XTR"
     - prices is a single LabeledPrice in stars (whole units)
     - provider_token MUST be empty for Stars
   See: https://core.telegram.org/bots/payments-stars
   ========================================================= */

"use strict";

const ALLOWED_PACKS = {
  // amount = Telegram Stars price; payload encodes the boost type.
  energy:  { amount: 25,  title: "Energy refill",  description: "Refill combat energy to max." },
  damage:  { amount: 75,  title: "Damage boost",   description: "+50% tap damage for the next fight." },
  revive:  { amount: 50,  title: "Revive",         description: "Revive fighter and restore HP." },
  starter: { amount: 100, title: "Starter pack",   description: "Energy refill + damage boost combo." }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > 16 * 1024) {
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

function sanitizeStr(value, maxLen) {
  if (value == null) return "";
  let s = String(value);
  s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return; }

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  if (!token) {
    sendJson(res, 503, {
      error: "stars_not_configured",
      message:
        "Telegram bot token is not configured. " +
        "Set TELEGRAM_BOT_TOKEN (or BOT_TOKEN) in the deployment " +
        "environment to enable Stars payments."
    });
    return;
  }

  let body;
  try { body = await readJson(req); }
  catch (e) { sendJson(res, 400, { error: e.message || "invalid_json" }); return; }

  const packId = sanitizeStr(body && body.pack, 32).toLowerCase();
  const pack = ALLOWED_PACKS[packId];
  if (!pack) {
    sendJson(res, 400, {
      error: "unknown_pack",
      allowed: Object.keys(ALLOWED_PACKS)
    });
    return;
  }

  // Optional FE-supplied metadata (kept compact, never logged).
  const symbol = sanitizeStr(body && body.symbol, 20).toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  const userId = sanitizeStr(body && body.user_id, 32);

  // Payload echoed back by Telegram after successful payment; the FE only
  // uses it client-side to confirm which pack was bought.
  const payload = JSON.stringify({
    p: packId,
    s: symbol || null,
    u: userId || null,
    t: Date.now()
  }).slice(0, 128);

  const tgPayload = {
    title: pack.title,
    description: pack.description,
    payload: payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: pack.title, amount: pack.amount }]
  };

  const url = "https://api.telegram.org/bot" + token + "/createInvoiceLink";
  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 15000);
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgPayload),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    sendJson(res, 504, {
      error: aborted ? "stars_upstream_timeout" : "stars_upstream_unreachable"
    });
    return;
  }

  let data;
  try { data = await upstream.json(); }
  catch (e) { sendJson(res, 502, { error: "stars_upstream_bad_json" }); return; }

  if (!upstream.ok || !data || data.ok !== true || !data.result) {
    // Never echo the token. Surface only the Telegram error description.
    const desc = data && (data.description || data.error_code)
      ? String(data.description || data.error_code).slice(0, 200)
      : null;
    sendJson(res, 502, {
      error: "stars_upstream_error",
      status: upstream.status,
      detail: desc
    });
    return;
  }

  sendJson(res, 200, {
    invoice_link: String(data.result),
    pack: packId,
    amount: pack.amount,
    currency: "XTR",
    ts: Date.now()
  });
};
