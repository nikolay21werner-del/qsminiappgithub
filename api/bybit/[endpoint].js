/* =========================================================
   QUANTSIGNAL AI — /api/bybit/<endpoint> (Vercel serverless function)

   Same-origin proxy for Bybit V5 PUBLIC market data. Telegram WebView
   and modern browsers refuse cross-origin REST calls to api.bybit.com
   because Bybit does not send permissive CORS headers; routing through
   this function makes those calls same-origin and unblocks ticker /
   kline / instrument loading.

   IMPORTANT: This is NOT an open proxy. Only a small, hard-coded set of
   public market read endpoints is allowed, and every query parameter is
   validated before being forwarded.

   Allowed endpoints (GET only, category=linear is enforced server-side):
     /api/bybit/tickers           -> https://api.bybit.com/v5/market/tickers
     /api/bybit/kline             -> https://api.bybit.com/v5/market/kline
     /api/bybit/instruments-info  -> https://api.bybit.com/v5/market/instruments-info

   No secrets are required. The function never accepts a request body and
   never forwards arbitrary headers.
   ========================================================= */

"use strict";

const BYBIT_REST = "https://api.bybit.com";
const UPSTREAM_TIMEOUT_MS = 8000;

// Map of safe public endpoints we are willing to forward.
const ALLOWED_ENDPOINTS = {
  tickers: "/v5/market/tickers",
  kline: "/v5/market/kline",
  "instruments-info": "/v5/market/instruments-info"
};

// Bybit kline interval enumeration (minute strings + D/W/M).
const ALLOWED_INTERVALS = new Set([
  "1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"
]);

// Symbols are upper-case alphanumeric and short. Real Bybit linear symbols
// look like "BTCUSDT" or "1000PEPEUSDT" — a 3..30 character cap is plenty.
const SYMBOL_RE = /^[A-Z0-9]{3,30}$/;

// Per-endpoint cache headers. Tickers move every second so we cache for
// only a few seconds; the kline / instruments payloads change much less
// frequently. Error responses get a short s-maxage so a transient Bybit
// outage cannot poison the CDN.
const CACHE_HEADERS = {
  tickers: "public, s-maxage=5, stale-while-revalidate=10",
  kline: "public, s-maxage=15, stale-while-revalidate=30",
  "instruments-info": "public, s-maxage=300, stale-while-revalidate=600"
};
const ERROR_CACHE_HEADER = "public, s-maxage=2, stale-while-revalidate=5";

function sendJson(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl || ERROR_CACHE_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

// Build a validated upstream URL or throw {status, code, message}.
function buildUpstreamUrl(endpoint, query) {
  const upstreamPath = ALLOWED_ENDPOINTS[endpoint];
  if (!upstreamPath) {
    const err = new Error("unknown endpoint");
    err.status = 404;
    err.code = "endpoint_not_allowed";
    throw err;
  }

  const params = new URLSearchParams();
  // category is enforced — only "linear" is supported even though Bybit
  // exposes more. This keeps the proxy surface narrow and predictable.
  params.set("category", "linear");

  const symbol = pickString(query.symbol);
  if (symbol) {
    if (!SYMBOL_RE.test(symbol)) {
      throwBad("invalid_symbol", "symbol must match [A-Z0-9]{3,30}");
    }
    params.set("symbol", symbol);
  } else if (endpoint === "kline") {
    throwBad("missing_symbol", "kline requires symbol");
  }

  if (endpoint === "kline") {
    const interval = pickString(query.interval) || "5";
    if (!ALLOWED_INTERVALS.has(interval)) {
      throwBad("invalid_interval", "interval not in allowed set");
    }
    params.set("interval", interval);

    const limit = clampInt(query.limit, 1, 1000, 60);
    params.set("limit", String(limit));

    const start = pickString(query.start);
    if (start) {
      if (!/^\d{10,16}$/.test(start)) throwBad("invalid_start", "start must be epoch ms");
      params.set("start", start);
    }
    const end = pickString(query.end);
    if (end) {
      if (!/^\d{10,16}$/.test(end)) throwBad("invalid_end", "end must be epoch ms");
      params.set("end", end);
    }
  }

  if (endpoint === "instruments-info") {
    const limit = clampInt(query.limit, 1, 1000, 1000);
    params.set("limit", String(limit));
    const cursor = pickString(query.cursor);
    // Bybit cursors are opaque base64-ish tokens; cap length and charset.
    if (cursor) {
      if (cursor.length > 256 || !/^[A-Za-z0-9+/=%._-]+$/.test(cursor)) {
        throwBad("invalid_cursor", "cursor contains disallowed characters");
      }
      params.set("cursor", cursor);
    }
  }

  return BYBIT_REST + upstreamPath + "?" + params.toString();
}

function pickString(v) {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== "string") return "";
  return v.trim();
}

function clampInt(v, min, max, dflt) {
  const s = pickString(v);
  if (!s) return dflt;
  if (!/^\d{1,5}$/.test(s)) {
    throwBad("invalid_limit", "limit must be a small positive integer");
  }
  const n = parseInt(s, 10);
  if (!isFinite(n) || n < min) return min;
  if (n > max) return max;
  return n;
}

function throwBad(code, message) {
  const e = new Error(message || code);
  e.status = 400;
  e.code = code;
  throw e;
}

function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
  return fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "quantsignal-proxy/1.0"
    },
    signal: ctrl.signal,
    cache: "no-store"
  }).finally(function () { clearTimeout(timer); });
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  // Vercel populates req.query from the dynamic segment + ?params.
  const query = req.query || {};
  const endpoint = pickString(query.endpoint);

  let upstreamUrl;
  try {
    upstreamUrl = buildUpstreamUrl(endpoint, query);
  } catch (e) {
    return sendJson(res, e.status || 400, {
      error: e.code || "bad_request",
      message: e.message || "bad request"
    });
  }

  let upstream;
  try {
    upstream = await fetchWithTimeout(upstreamUrl, UPSTREAM_TIMEOUT_MS);
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    return sendJson(res, 504, {
      error: isAbort ? "upstream_timeout" : "upstream_unreachable",
      message: String((e && e.message) || e)
    });
  }

  const text = await upstream.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* non-JSON */ }

  if (!upstream.ok || !parsed || parsed.retCode !== 0) {
    return sendJson(res, upstream.ok ? 502 : upstream.status, {
      error: "upstream_error",
      status: upstream.status,
      retCode: parsed ? parsed.retCode : null,
      retMsg: parsed ? parsed.retMsg : null
    });
  }

  return sendJson(res, 200, parsed, CACHE_HEADERS[endpoint]);
}

module.exports = handler;
module.exports.default = handler;
// Exported for unit tests (CommonJS for Node smoke harness compatibility).
module.exports._internals = {
  buildUpstreamUrl: buildUpstreamUrl,
  ALLOWED_ENDPOINTS: ALLOWED_ENDPOINTS,
  ALLOWED_INTERVALS: ALLOWED_INTERVALS,
  SYMBOL_RE: SYMBOL_RE
};
