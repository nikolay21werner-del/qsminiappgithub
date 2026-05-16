#!/usr/bin/env node
/* Smoke test for the Bybit same-origin proxy (api/bybit/[endpoint].js).

   Tests:
     1. Path / query validation rejects bad inputs.
     2. Allowed endpoints build correct upstream URLs.
     3. The handler returns the proper JSON shape for both validation
        errors and a mocked upstream success.
     4. The frontend api.js builds /api/bybit/* URLs as expected.

   No network is required — upstream `fetch` is monkey-patched. */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handler = require(path.join(__dirname, "..", "api", "bybit", "[endpoint].js"));
const { buildUpstreamUrl, ALLOWED_INTERVALS, SYMBOL_RE, COINBASE_MAP, KRAKEN_MAP } = handler._internals;

let pass = 0;
let fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log("[OK]   " + label); }
  else      { fail++; console.log("[FAIL] " + label + (detail ? "  " + detail : "")); }
}

// ---------- buildUpstreamUrl ----------
try {
  const u = buildUpstreamUrl("tickers", {});
  check("tickers: minimal builds linear category", u === "https://api.bybit.com/v5/market/tickers?category=linear", u);
} catch (e) { check("tickers: minimal builds linear category", false, e.message); }

try {
  const u = buildUpstreamUrl("tickers", { symbol: "BTCUSDT" });
  check("tickers: passes symbol", u.includes("symbol=BTCUSDT"), u);
} catch (e) { check("tickers: passes symbol", false, e.message); }

try {
  buildUpstreamUrl("tickers", { symbol: "btcusdt" });
  check("tickers: rejects lower-case symbol", false, "no throw");
} catch (e) { check("tickers: rejects lower-case symbol", e.code === "invalid_symbol", e.code); }

try {
  buildUpstreamUrl("tickers", { symbol: "BTC;DROP" });
  check("tickers: rejects injected punctuation", false, "no throw");
} catch (e) { check("tickers: rejects injected punctuation", e.code === "invalid_symbol", e.code); }

try {
  buildUpstreamUrl("kline", {});
  check("kline: requires symbol", false, "no throw");
} catch (e) { check("kline: requires symbol", e.code === "missing_symbol", e.code); }

try {
  const u = buildUpstreamUrl("kline", { symbol: "BTCUSDT", interval: "5", limit: "60" });
  check("kline: builds minimal URL", u.includes("symbol=BTCUSDT") && u.includes("interval=5") && u.includes("limit=60"), u);
} catch (e) { check("kline: builds minimal URL", false, e.message); }

try {
  buildUpstreamUrl("kline", { symbol: "BTCUSDT", interval: "7" });
  check("kline: rejects unknown interval", false, "no throw");
} catch (e) { check("kline: rejects unknown interval", e.code === "invalid_interval", e.code); }

try {
  const u = buildUpstreamUrl("kline", { symbol: "BTCUSDT", interval: "D", limit: "9999" });
  check("kline: clamps limit to 1000", u.includes("limit=1000"), u);
} catch (e) { check("kline: clamps limit to 1000", false, e.message); }

try {
  buildUpstreamUrl("kline", { symbol: "BTCUSDT", interval: "5", limit: "not-a-number" });
  check("kline: rejects non-numeric limit", false, "no throw");
} catch (e) { check("kline: rejects non-numeric limit", e.code === "invalid_limit", e.code); }

try {
  const u = buildUpstreamUrl("instruments-info", {});
  check("instruments-info: defaults limit=1000", u.includes("limit=1000"), u);
} catch (e) { check("instruments-info: defaults limit=1000", false, e.message); }

try {
  buildUpstreamUrl("orderbook", {});
  check("rejects unknown endpoint", false, "no throw");
} catch (e) { check("rejects unknown endpoint", e.code === "endpoint_not_allowed", e.code); }

// Make sure D/W/M and the documented intervals are valid.
for (const v of ["1", "3", "5", "15", "60", "240", "D", "W", "M"]) {
  check("interval " + v + " allowed", ALLOWED_INTERVALS.has(v));
}
check("interval '0' rejected", !ALLOWED_INTERVALS.has("0"));
check("SYMBOL_RE accepts 1000PEPEUSDT", SYMBOL_RE.test("1000PEPEUSDT"));
check("SYMBOL_RE rejects ../etc", !SYMBOL_RE.test("../etc"));

// ---------- end-to-end handler with mocked fetch ----------
async function runHandler(query, mockFetch) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  let statusCode = 0;
  const headers = {};
  let body = "";
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(s) { body = s; statusCode = this.statusCode; }
  };
  try {
    await handler({ method: "GET", query }, res);
  } finally {
    global.fetch = originalFetch;
  }
  let parsed = null;
  try { parsed = JSON.parse(body); } catch (_) {}
  return { status: statusCode, headers, body: parsed };
}

(async () => {
  // Validation error: missing symbol on kline
  {
    const r = await runHandler({ endpoint: "kline" }, async () => { throw new Error("upstream should not be called"); });
    check("handler 400 on missing kline symbol", r.status === 400 && r.body && r.body.error === "missing_symbol", JSON.stringify(r));
  }

  // Unknown endpoint
  {
    const r = await runHandler({ endpoint: "nope" }, async () => { throw new Error("should not call"); });
    check("handler 404 on unknown endpoint", r.status === 404 && r.body && r.body.error === "endpoint_not_allowed", JSON.stringify(r));
  }

  // Successful upstream
  {
    const payload = { retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", lastPrice: "67000" }] } };
    const r = await runHandler({ endpoint: "tickers" }, async (url) => {
      if (!url.startsWith("https://api.bybit.com/v5/market/tickers?")) throw new Error("bad upstream url: " + url);
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    });
    check("handler 200 on tickers success", r.status === 200 && r.body && r.body.retCode === 0, JSON.stringify(r));
    check("handler sets cache for tickers", /s-maxage=5/.test(r.headers["cache-control"] || ""), r.headers["cache-control"]);
  }

  // Upstream returns retCode != 0 for an unmapped symbol -> no fallback, surfaces as 503
  {
    const r = await runHandler({ endpoint: "kline", symbol: "EXOTICUSDT", interval: "5", limit: "10" }, async (url) => {
      // Only Bybit gets called; both fallbacks reject because EXOTICUSDT
      // is not in COINBASE_MAP / KRAKEN_MAP and the handler short-circuits.
      if (url.startsWith("https://api.bybit.com/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ retCode: 10001, retMsg: "params error" }) };
      }
      throw new Error("no fallback expected for EXOTICUSDT: " + url);
    });
    check("handler 503 provider_unavailable when no fallback covers symbol",
      r.status === 503 && r.body && r.body.error === "provider_unavailable", JSON.stringify(r));
  }

  // Bybit 403 (production scenario) + Coinbase fallback succeeds -> 200 with coinbase shape
  {
    const cbCandles = [
      // [time(s), low, high, open, close, volume]   newest first
      [1715000000, 100, 110, 105, 108, 12.34],
      [1714999700, 99, 109, 104, 105, 9.87]
    ];
    const r = await runHandler({ endpoint: "kline", symbol: "BTCUSDT", interval: "5", limit: "10" }, async (url) => {
      if (url.startsWith("https://api.bybit.com/")) {
        return { ok: false, status: 403, text: async () => "Forbidden" };
      }
      if (url.startsWith("https://api.exchange.coinbase.com/products/BTC-USDT/candles")) {
        return { ok: true, status: 200, json: async () => cbCandles, text: async () => JSON.stringify(cbCandles) };
      }
      throw new Error("unexpected fallback url: " + url);
    });
    check("handler falls back to Coinbase on Bybit 403 (kline)",
      r.status === 200 && r.body && r.body.retCode === 0 && r.body._provider === "coinbase"
        && Array.isArray(r.body.result.list) && r.body.result.list.length === 2,
      JSON.stringify(r));
    // Bybit kline shape is [start_ms, open, high, low, close, volume, turnover]
    const row = r.body && r.body.result && r.body.result.list && r.body.result.list[0];
    check("Coinbase fallback row uses Bybit-like [ts,o,h,l,c,v,turnover] shape",
      Array.isArray(row) && row.length === 7 && row[0] === "1715000000000",
      JSON.stringify(row));
  }

  // Bybit 403 for tickers, Coinbase succeeds for BTCUSDT
  {
    const r = await runHandler({ endpoint: "tickers", symbol: "BTCUSDT" }, async (url) => {
      if (url.startsWith("https://api.bybit.com/")) {
        return { ok: false, status: 403, text: async () => "Forbidden" };
      }
      if (url.indexOf("/products/BTC-USDT/ticker") >= 0) {
        return { ok: true, status: 200, json: async () => ({ price: "67000" }), text: async () => "{}" };
      }
      if (url.indexOf("/products/BTC-USDT/stats") >= 0) {
        return { ok: true, status: 200, json: async () => ({ open: "66000", high: "68000", low: "65000", volume: "1234.5" }), text: async () => "{}" };
      }
      throw new Error("unexpected url: " + url);
    });
    check("handler falls back to Coinbase on Bybit 403 (tickers)",
      r.status === 200 && r.body && r.body._provider === "coinbase"
        && r.body.result && Array.isArray(r.body.result.list) && r.body.result.list[0].symbol === "BTCUSDT"
        && parseFloat(r.body.result.list[0].lastPrice) === 67000,
      JSON.stringify(r));
  }

  // Bybit 403, Coinbase fails, Kraken succeeds for BTCUSDT kline
  {
    const krakenRows = [
      [1714999700, "104", "109", "99", "105", "104.5", "9.87", 12],
      [1715000000, "105", "110", "100", "108", "107", "12.34", 18]
    ];
    const r = await runHandler({ endpoint: "kline", symbol: "BTCUSDT", interval: "5", limit: "10" }, async (url) => {
      if (url.startsWith("https://api.bybit.com/")) return { ok: false, status: 403, text: async () => "Forbidden" };
      if (url.indexOf("api.exchange.coinbase.com") >= 0) return { ok: false, status: 451, text: async () => "blocked" };
      if (url.indexOf("api.kraken.com") >= 0) {
        return { ok: true, status: 200, json: async () => ({ result: { XBTUSDT: krakenRows, last: 1715000000 } }), text: async () => "{}" };
      }
      throw new Error("unexpected url: " + url);
    });
    check("handler falls back to Kraken when Coinbase also fails",
      r.status === 200 && r.body && r.body._provider === "kraken"
        && Array.isArray(r.body.result.list) && r.body.result.list.length === 2,
      JSON.stringify(r));
  }

  // Bybit 403 + no provider supports the symbol -> 503 provider_unavailable
  {
    const r = await runHandler({ endpoint: "kline", symbol: "NOTREALUSDT", interval: "5", limit: "10" }, async (url) => {
      if (url.startsWith("https://api.bybit.com/")) return { ok: false, status: 403, text: async () => "Forbidden" };
      throw new Error("fallback should be skipped for unmapped symbol");
    });
    check("handler 503 provider_unavailable when no provider supports symbol",
      r.status === 503 && r.body && r.body.error === "provider_unavailable"
        && r.body.primary && r.body.primary.status === 403,
      JSON.stringify(r));
  }

  // Network failure on Bybit + fallback unmapped -> 503
  {
    const r = await runHandler({ endpoint: "tickers", symbol: "WEIRDUSDT" }, async (url) => {
      if (url.startsWith("https://api.bybit.com/")) throw new Error("network down");
      throw new Error("unexpected url: " + url);
    });
    check("handler 503 provider_unavailable when Bybit unreachable + symbol unmapped",
      r.status === 503 && r.body && r.body.error === "provider_unavailable",
      JSON.stringify(r));
  }

  // instruments-info has no fallback — still surfaces upstream errors as before
  {
    const r = await runHandler({ endpoint: "instruments-info" }, async () => { throw new Error("network down"); });
    check("instruments-info has no fallback (504 on network failure)",
      r.status === 504 && r.body && /upstream_/.test(r.body.error), JSON.stringify(r));
  }

  // Sanity-check the maps are populated with the common symbols the user asked for.
  check("COINBASE_MAP covers BTC/ETH/SOL/DOGE/XRP", ["BTCUSDT","ETHUSDT","SOLUSDT","DOGEUSDT","XRPUSDT"].every(s => !!COINBASE_MAP[s]));
  check("KRAKEN_MAP covers BTC/ETH/SOL/ADA/LTC/DOT/LINK/AVAX", ["BTCUSDT","ETHUSDT","SOLUSDT","ADAUSDT","LTCUSDT","DOTUSDT","LINKUSDT","AVAXUSDT"].every(s => !!KRAKEN_MAP[s]));

  // ---------- Frontend URL construction smoke test ----------
  // Load api.js as text and run it in a fake window where fetch is mocked.
  const apiText = readFileSync(path.join(__dirname, "..", "api.js"), "utf8");
  const seen = [];
  const fakeWindow = {
    QSI_API_BASE: "",
    WebSocket: undefined
  };
  const fakeFetch = (url, opts) => {
    seen.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ retCode: 0, result: { list: [] } })
    });
  };

  // Build a sandboxed Function so the IIFE binds to fakeWindow.
  const sandbox = new Function("window", "fetch", "WebSocket", apiText);
  sandbox.call(fakeWindow, fakeWindow, fakeFetch, fakeWindow.WebSocket);
  await fakeWindow.QSI_API.bybitGetTickers([]).catch(() => {});
  await fakeWindow.QSI_API.bybitGetKlines("BTCUSDT", "5", 10).catch(() => {});

  check("frontend hits /api/bybit/tickers", seen.some(u => u.startsWith("/api/bybit/tickers")), JSON.stringify(seen));
  check("frontend hits /api/bybit/kline with symbol+interval+limit",
    seen.some(u => u.startsWith("/api/bybit/kline") && u.includes("symbol=BTCUSDT") && u.includes("interval=5") && u.includes("limit=10")),
    JSON.stringify(seen));
  check("frontend does NOT default to direct api.bybit.com",
    !seen.some(u => u.startsWith("https://api.bybit.com")),
    JSON.stringify(seen));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
