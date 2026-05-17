/* =========================================================
   QUANTSIGNAL AI — Shared market data helpers.

   Server-side fetchers with strict per-request timeouts and a robust
   Bybit -> Coinbase -> Kraken fallback. Designed to be reused by
   /api/channel/post and the new /api/content/* endpoints so latency
   stays predictable and the same symbol coverage is enforced everywhere.

   No external HTTP libraries; relies on the runtime's global `fetch`.
   ========================================================= */
"use strict";

const UPSTREAM_TIMEOUT_MS = 7000;

const SYMBOLS = ["BTC", "ETH", "SOL", "TON", "DOGE"];

const BYBIT_SYMBOL = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT",
  TON: "TONUSDT", DOGE: "DOGEUSDT"
};
const COINBASE_SYMBOL = {
  BTC: "BTC-USDT", ETH: "ETH-USDT", SOL: "SOL-USDT",
  DOGE: "DOGE-USDT"
};
const KRAKEN_SYMBOL = {
  BTC: "XBTUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT",
  DOGE: "XDGUSDT", TON: "TONUSDT"
};

function num(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || UPSTREAM_TIMEOUT_MS);
  const init = Object.assign({
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "quantsignal-content/1.0" },
    signal: ctrl.signal,
    cache: "no-store"
  }, opts || {});
  return fetch(url, init).finally(function () { clearTimeout(timer); });
}

async function bybitTicker(sym) {
  try {
    const r = await fetchWithTimeout(
      "https://api.bybit.com/v5/market/tickers?category=linear&symbol=" + BYBIT_SYMBOL[sym],
      null, UPSTREAM_TIMEOUT_MS
    );
    if (!r.ok) return null;
    const j = await r.json();
    const t = j && j.result && Array.isArray(j.result.list) && j.result.list[0];
    if (!t) return null;
    const last = num(t.lastPrice);
    const pcp = num(t.price24hPcnt);
    if (last == null) return null;
    return {
      sym: sym, last: last,
      pct: pcp == null ? null : pcp * 100,
      high: num(t.highPrice24h),
      low: num(t.lowPrice24h),
      vol: num(t.turnover24h),
      source: "bybit"
    };
  } catch (_) { return null; }
}

async function coinbaseTicker(sym) {
  const id = COINBASE_SYMBOL[sym];
  if (!id) return null;
  try {
    const [tk, st] = await Promise.all([
      fetchWithTimeout("https://api.exchange.coinbase.com/products/" + id + "/ticker", null, UPSTREAM_TIMEOUT_MS),
      fetchWithTimeout("https://api.exchange.coinbase.com/products/" + id + "/stats", null, UPSTREAM_TIMEOUT_MS)
    ]);
    if (!tk.ok || !st.ok) return null;
    const t = await tk.json();
    const s = await st.json();
    const last = num(t.price);
    const open = num(s.open);
    if (last == null) return null;
    const pct = open && open > 0 ? ((last - open) / open) * 100 : null;
    return {
      sym: sym, last: last, pct: pct,
      high: num(s.high), low: num(s.low), vol: num(s.volume),
      source: "coinbase"
    };
  } catch (_) { return null; }
}

async function krakenTicker(sym) {
  const id = KRAKEN_SYMBOL[sym];
  if (!id) return null;
  try {
    const r = await fetchWithTimeout(
      "https://api.kraken.com/0/public/Ticker?pair=" + id, null, UPSTREAM_TIMEOUT_MS
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.result) return null;
    const keys = Object.keys(j.result);
    if (!keys.length) return null;
    const t = j.result[keys[0]];
    const last = num(t && t.c && t.c[0]);
    const open = num(t && t.o);
    if (last == null) return null;
    const pct = open && open > 0 ? ((last - open) / open) * 100 : null;
    return {
      sym: sym, last: last, pct: pct,
      high: num(t && t.h && t.h[1]),
      low: num(t && t.l && t.l[1]),
      vol: num(t && t.v && t.v[1]),
      source: "kraken"
    };
  } catch (_) { return null; }
}

async function fetchSymbol(sym) {
  const a = await bybitTicker(sym);
  if (a) return a;
  const b = await coinbaseTicker(sym);
  if (b) return b;
  const c = await krakenTicker(sym);
  if (c) return c;
  return {
    sym: sym, last: null, pct: null, high: null, low: null, vol: null,
    source: "unavailable"
  };
}

// Parallel fetch with allSettled so a single upstream failure cannot
// stall the post pipeline.
async function fetchSnapshot(symbols) {
  const list = Array.isArray(symbols) && symbols.length ? symbols : SYMBOLS;
  const settled = await Promise.allSettled(list.map(fetchSymbol));
  const warnings = [];
  const rows = settled.map(function (s, i) {
    if (s.status === "fulfilled" && s.value) return s.value;
    warnings.push("symbol_fetch_failed:" + list[i]);
    return {
      sym: list[i], last: null, pct: null, high: null, low: null, vol: null,
      source: "unavailable"
    };
  });
  return { rows: rows, warnings: warnings };
}

module.exports = {
  SYMBOLS: SYMBOLS,
  fetchSymbol: fetchSymbol,
  fetchSnapshot: fetchSnapshot,
  fetchWithTimeout: fetchWithTimeout,
  num: num
};
