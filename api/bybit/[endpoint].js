/* =========================================================
   QUANTSIGNAL AI — /api/bybit/<endpoint> (Vercel serverless function)

   Same-origin proxy for public market data. Primary upstream is Bybit V5
   linear perpetuals; when Bybit blocks the Vercel egress IP (HTTP 403) or
   is otherwise unreachable, the proxy transparently falls back to public
   Coinbase Exchange and Kraken endpoints for the supported symbols and
   re-shapes their responses into the Bybit-like envelope the client
   already understands. If no provider can serve a request, the proxy
   returns a structured `provider_unavailable` error so the UI can render
   an honest "unavailable" overlay instead of spinning forever.

   Allowed endpoints (GET only, category=linear is enforced server-side):
     /api/bybit/tickers           -> Bybit /v5/market/tickers      (+ fallback)
     /api/bybit/kline             -> Bybit /v5/market/kline        (+ fallback)
     /api/bybit/instruments-info  -> Bybit /v5/market/instruments-info

   No secrets are required. The function never accepts a request body and
   never forwards arbitrary headers.
   ========================================================= */

"use strict";

const BYBIT_REST = "https://api.bybit.com";
const COINBASE_REST = "https://api.exchange.coinbase.com";
const KRAKEN_REST = "https://api.kraken.com";
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

// Fallback symbol coverage. Coinbase Exchange exposes a relatively narrow
// set of USDT spot pairs; Kraken covers a broader set under its own naming.
// We only register pairs we've confirmed exist on the public REST API.
const COINBASE_MAP = {
  BTCUSDT: "BTC-USDT",
  ETHUSDT: "ETH-USDT",
  SOLUSDT: "SOL-USDT",
  XRPUSDT: "XRP-USDT",
  DOGEUSDT: "DOGE-USDT",
  ADAUSDT: "ADA-USDT",
  AVAXUSDT: "AVAX-USDT",
  LINKUSDT: "LINK-USDT",
  DOTUSDT: "DOT-USDT",
  LTCUSDT: "LTC-USDT",
  BCHUSDT: "BCH-USDT",
  ATOMUSDT: "ATOM-USDT",
  UNIUSDT: "UNI-USDT",
  AAVEUSDT: "AAVE-USDT",
  FILUSDT: "FIL-USDT",
  ETCUSDT: "ETC-USDT",
  ALGOUSDT: "ALGO-USDT",
  XLMUSDT: "XLM-USDT",
  NEARUSDT: "NEAR-USDT",
  ARBUSDT: "ARB-USDT",
  OPUSDT: "OP-USDT",
  APTUSDT: "APT-USDT",
  SUIUSDT: "SUI-USDT"
};

const KRAKEN_MAP = {
  BTCUSDT: "XBTUSDT",
  ETHUSDT: "ETHUSDT",
  SOLUSDT: "SOLUSDT",
  XRPUSDT: "XRPUSDT",
  DOGEUSDT: "XDGUSDT",
  ADAUSDT: "ADAUSDT",
  AVAXUSDT: "AVAXUSDT",
  LINKUSDT: "LINKUSDT",
  DOTUSDT: "DOTUSDT",
  LTCUSDT: "LTCUSDT",
  BCHUSDT: "BCHUSDT",
  ATOMUSDT: "ATOMUSDT",
  UNIUSDT: "UNIUSDT",
  AAVEUSDT: "AAVEUSDT",
  FILUSDT: "FILUSDT",
  ETCUSDT: "ETCUSDT",
  ALGOUSDT: "ALGOUSDT",
  XLMUSDT: "XLMUSDT",
  NEARUSDT: "NEARUSDT",
  TRXUSDT: "TRXUSDT",
  MATICUSDT: "MATICUSDT",
  APTUSDT: "APTUSDT",
  SUIUSDT: "SUIUSDT"
};

// Bybit minute interval -> Coinbase candle granularity (seconds).
// Coinbase only exposes a fixed set: 60, 300, 900, 3600, 21600, 86400.
const COINBASE_GRANULARITY = {
  "1": 60, "3": 60, "5": 300, "15": 900, "30": 900,
  "60": 3600, "120": 3600, "240": 21600, "360": 21600, "720": 21600,
  D: 86400, W: 86400, M: 86400
};

// Bybit minute interval -> Kraken OHLC interval (minutes).
// Kraken exposes 1,5,15,30,60,240,1440,10080,21600.
const KRAKEN_INTERVAL = {
  "1": 1, "3": 5, "5": 5, "15": 15, "30": 30,
  "60": 60, "120": 60, "240": 240, "360": 240, "720": 240,
  D: 1440, W: 10080, M: 21600
};

// Per-endpoint cache headers. Tickers move every second so we cache for
// only a few seconds; the kline / instruments payloads change much less
// frequently. Error responses get a short s-maxage so a transient outage
// cannot poison the CDN.
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

// Build a validated Bybit upstream URL or throw {status, code, message}.
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

// Attempt the primary Bybit upstream. Returns either
//   { ok: true, data }                  — parsed Bybit JSON with retCode===0
//   { ok: false, status, reason }       — non-success; caller may fall back
async function tryBybit(upstreamUrl) {
  let upstream;
  try {
    upstream = await fetchWithTimeout(upstreamUrl, UPSTREAM_TIMEOUT_MS);
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    return { ok: false, status: 0, reason: isAbort ? "upstream_timeout" : "upstream_unreachable", message: String((e && e.message) || e) };
  }
  const text = await upstream.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* non-JSON */ }
  if (!upstream.ok || !parsed || parsed.retCode !== 0) {
    return {
      ok: false,
      status: upstream.status,
      reason: "upstream_error",
      retCode: parsed ? parsed.retCode : null,
      retMsg: parsed ? parsed.retMsg : null
    };
  }
  return { ok: true, data: parsed };
}

// ---------- Coinbase Exchange fallback ----------
async function coinbaseTickers(symbol) {
  // /products/{id}/ticker + /products/{id}/stats give us last/24h change/volume.
  const wantedSymbols = symbol ? [symbol] : Object.keys(COINBASE_MAP);
  const list = [];
  for (const sym of wantedSymbols) {
    const product = COINBASE_MAP[sym];
    if (!product) continue;
    try {
      const [tickerResp, statsResp] = await Promise.all([
        fetchWithTimeout(COINBASE_REST + "/products/" + product + "/ticker", UPSTREAM_TIMEOUT_MS),
        fetchWithTimeout(COINBASE_REST + "/products/" + product + "/stats", UPSTREAM_TIMEOUT_MS)
      ]);
      if (!tickerResp.ok || !statsResp.ok) continue;
      const tk = await tickerResp.json();
      const st = await statsResp.json();
      const last = parseFloat(tk.price);
      const open = parseFloat(st.open);
      const high = parseFloat(st.high);
      const low = parseFloat(st.low);
      const vol = parseFloat(st.volume);
      if (!isFinite(last)) continue;
      // Bybit reports price24hPcnt as a decimal fraction (e.g. 0.0184 = 1.84%).
      const changePct = (isFinite(open) && open !== 0) ? (last - open) / open : 0;
      list.push({
        symbol: sym,
        lastPrice: String(last),
        price24hPcnt: String(changePct),
        highPrice24h: isFinite(high) ? String(high) : String(last),
        lowPrice24h: isFinite(low) ? String(low) : String(last),
        // Bybit uses turnover24h (quote-asset notional). Coinbase /stats.volume
        // is base-asset volume; multiply by last price for a comparable figure.
        turnover24h: isFinite(vol) ? String(vol * last) : "0",
        volume24h: isFinite(vol) ? String(vol) : "0"
      });
    } catch (_) { /* try next symbol */ }
  }
  if (!list.length) return null;
  return { retCode: 0, retMsg: "OK", result: { category: "linear", list }, _provider: "coinbase" };
}

async function coinbaseKline(symbol, interval, limit) {
  const product = COINBASE_MAP[symbol];
  if (!product) return null;
  const granularity = COINBASE_GRANULARITY[interval];
  if (!granularity) return null;
  // Coinbase returns at most 300 candles per request. We request `limit`
  // and let the server cap it; we further trim client-side.
  const url = COINBASE_REST + "/products/" + product + "/candles?granularity=" + granularity;
  let resp;
  try { resp = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS); }
  catch (_) { return null; }
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  // Coinbase returns [time, low, high, open, close, volume] (newest first).
  // Bybit kline is newest first too: [start, open, high, low, close, volume, turnover].
  const out = rows.slice(0, limit).map(function (r) {
    const tsMs = String(parseInt(r[0], 10) * 1000);
    const low = String(r[1]);
    const high = String(r[2]);
    const open = String(r[3]);
    const close = String(r[4]);
    const vol = String(r[5]);
    // Turnover (quote volume) is approximated as close * volume.
    const turnover = String(parseFloat(r[4]) * parseFloat(r[5]));
    return [tsMs, open, high, low, close, vol, turnover];
  });
  return {
    retCode: 0,
    retMsg: "OK",
    result: { category: "linear", symbol, list: out },
    _provider: "coinbase"
  };
}

// ---------- Kraken fallback ----------
async function krakenTickers(symbol) {
  const wantedSymbols = symbol ? [symbol] : Object.keys(KRAKEN_MAP);
  const pairs = wantedSymbols
    .map(function (s) { return { sym: s, kraken: KRAKEN_MAP[s] }; })
    .filter(function (x) { return !!x.kraken; });
  if (!pairs.length) return null;
  // Kraken accepts a comma-separated pair list.
  const url = KRAKEN_REST + "/0/public/Ticker?pair=" + encodeURIComponent(pairs.map(function (p) { return p.kraken; }).join(","));
  let resp;
  try { resp = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS); }
  catch (_) { return null; }
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json || !json.result) return null;
  const list = [];
  // Kraken sometimes prefixes asset names with X/Z; we have to match loosely.
  const resultKeys = Object.keys(json.result);
  pairs.forEach(function (p) {
    let row = json.result[p.kraken];
    if (!row) {
      const match = resultKeys.find(function (k) { return k.indexOf(p.kraken) >= 0; });
      if (match) row = json.result[match];
    }
    if (!row || !row.c) return;
    const last = parseFloat(row.c[0]);
    const open = parseFloat(row.o);
    const high = parseFloat(Array.isArray(row.h) ? row.h[1] : row.h);
    const low = parseFloat(Array.isArray(row.l) ? row.l[1] : row.l);
    const vol = parseFloat(Array.isArray(row.v) ? row.v[1] : row.v);
    if (!isFinite(last)) return;
    const changePct = (isFinite(open) && open !== 0) ? (last - open) / open : 0;
    list.push({
      symbol: p.sym,
      lastPrice: String(last),
      price24hPcnt: String(changePct),
      highPrice24h: isFinite(high) ? String(high) : String(last),
      lowPrice24h: isFinite(low) ? String(low) : String(last),
      turnover24h: isFinite(vol) ? String(vol * last) : "0",
      volume24h: isFinite(vol) ? String(vol) : "0"
    });
  });
  if (!list.length) return null;
  return { retCode: 0, retMsg: "OK", result: { category: "linear", list }, _provider: "kraken" };
}

async function krakenKline(symbol, interval, limit) {
  const pair = KRAKEN_MAP[symbol];
  if (!pair) return null;
  const km = KRAKEN_INTERVAL[interval];
  if (!km) return null;
  const url = KRAKEN_REST + "/0/public/OHLC?pair=" + encodeURIComponent(pair) + "&interval=" + km;
  let resp;
  try { resp = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS); }
  catch (_) { return null; }
  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json || !json.result) return null;
  // Find the OHLC array under whichever key Kraken used.
  let rows = null;
  Object.keys(json.result).forEach(function (k) {
    if (k === "last") return;
    if (Array.isArray(json.result[k])) rows = json.result[k];
  });
  if (!rows || !rows.length) return null;
  // Kraken: [time(s), open, high, low, close, vwap, volume, count]. Newest last.
  // Bybit expects newest first; reverse and trim.
  const trimmed = rows.slice(-Math.min(limit, rows.length)).reverse();
  const out = trimmed.map(function (r) {
    const tsMs = String(parseInt(r[0], 10) * 1000);
    const open = String(r[1]);
    const high = String(r[2]);
    const low = String(r[3]);
    const close = String(r[4]);
    const vol = String(r[6]);
    const turnover = String(parseFloat(r[4]) * parseFloat(r[6]));
    return [tsMs, open, high, low, close, vol, turnover];
  });
  return {
    retCode: 0,
    retMsg: "OK",
    result: { category: "linear", symbol, list: out },
    _provider: "kraken"
  };
}

// Run fallback providers in order until one returns data, or null if none can.
async function runFallback(endpoint, query) {
  const symbol = pickString(query.symbol);
  if (endpoint === "tickers") {
    return (await coinbaseTickers(symbol)) || (await krakenTickers(symbol));
  }
  if (endpoint === "kline") {
    const interval = pickString(query.interval) || "5";
    const limit = clampInt(query.limit, 1, 1000, 60);
    return (await coinbaseKline(symbol, interval, limit)) || (await krakenKline(symbol, interval, limit));
  }
  // instruments-info has no public equivalent on Coinbase/Kraken with the
  // same shape — surfacing that catalog is a Bybit-specific concern.
  return null;
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

  const primary = await tryBybit(upstreamUrl);
  if (primary.ok) {
    return sendJson(res, 200, primary.data, CACHE_HEADERS[endpoint]);
  }

  // Only certain endpoints have fallbacks. instruments-info propagates the
  // original Bybit error since we have no equivalent catalog source.
  if (endpoint === "tickers" || endpoint === "kline") {
    let fb = null;
    try { fb = await runFallback(endpoint, query); } catch (_) { fb = null; }
    if (fb) {
      // Tag the response so the client can surface "provider: coinbase|kraken"
      // in diagnostics without changing the success shape.
      return sendJson(res, 200, fb, CACHE_HEADERS[endpoint]);
    }
    // No provider could serve this symbol — return a structured error so the
    // UI shows "unavailable" instead of hanging.
    return sendJson(res, 503, {
      error: "provider_unavailable",
      message: "no upstream could serve this request",
      primary: { status: primary.status, reason: primary.reason, retCode: primary.retCode || null, retMsg: primary.retMsg || null }
    });
  }

  // No-fallback endpoint: surface the original failure. Network failures
  // (status 0) preserve the 504 status the client previously relied on.
  let outStatus;
  if (primary.reason === "upstream_timeout" || primary.reason === "upstream_unreachable") {
    outStatus = 504;
  } else if (primary.status && primary.status >= 400) {
    outStatus = primary.status;
  } else {
    outStatus = 502;
  }
  return sendJson(res, outStatus, {
    error: primary.reason || "upstream_error",
    status: primary.status,
    retCode: primary.retCode || null,
    retMsg: primary.retMsg || null
  });
}

module.exports = handler;
module.exports.default = handler;
// Exported for unit tests (CommonJS for Node smoke harness compatibility).
module.exports._internals = {
  buildUpstreamUrl: buildUpstreamUrl,
  ALLOWED_ENDPOINTS: ALLOWED_ENDPOINTS,
  ALLOWED_INTERVALS: ALLOWED_INTERVALS,
  SYMBOL_RE: SYMBOL_RE,
  COINBASE_MAP: COINBASE_MAP,
  KRAKEN_MAP: KRAKEN_MAP,
  COINBASE_GRANULARITY: COINBASE_GRANULARITY,
  KRAKEN_INTERVAL: KRAKEN_INTERVAL
};
