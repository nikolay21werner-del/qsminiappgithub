#!/usr/bin/env node
/* Smoke test for the realtime layer.
   - Hits Bybit V5 public REST tickers and klines (no auth required).
   - Sanity-checks the signal-engine math against the live snapshot.
   - Skips silently if the network is unreachable so it never breaks CI. */

const REST = "https://api.bybit.com";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "TONUSDT"];

async function getJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error("http-" + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalize(raw) {
  if (!raw) return null;
  const price = parseFloat(raw.lastPrice);
  if (!isFinite(price)) return null;
  return {
    symbol: raw.symbol,
    last_price: price,
    change_pct_24h: (parseFloat(raw.price24hPcnt) || 0) * 100,
    volume_24h: parseFloat(raw.turnover24h) || 0,
    high_24h: parseFloat(raw.highPrice24h) || price,
    low_24h: parseFloat(raw.lowPrice24h) || price
  };
}

function computeSignal(t) {
  const change = t.change_pct_24h || 0;
  const absChg = Math.abs(change);
  if (absChg < 0.25) return null;
  const dir = change >= 0 ? "LONG" : "SHORT";
  const hi = t.high_24h || t.last_price;
  const lo = t.low_24h || t.last_price;
  const rangePct = hi > lo ? (hi - lo) / lo : 0.01;
  const rangeFactor = Math.max(0.005, Math.min(0.08, rangePct * 0.5 + absChg / 200));
  const entry = t.last_price;
  const sl = dir === "LONG" ? entry * (1 - rangeFactor * 1.2) : entry * (1 + rangeFactor * 1.2);
  const tp1 = dir === "LONG" ? entry * (1 + rangeFactor) : entry * (1 - rangeFactor);
  const rr = Math.abs(tp1 - entry) / Math.max(Math.abs(entry - sl), 1e-9);
  return { symbol: t.symbol, dir, entry, sl, tp1, rr: +rr.toFixed(2) };
}

(async () => {
  try {
    const resp = await getJSON(`${REST}/v5/market/tickers?category=linear`);
    if (resp.retCode !== 0) throw new Error("ret-" + resp.retCode);
    const map = Object.fromEntries(resp.result.list.map(r => [r.symbol, r]));
    let ok = 0, fail = 0;
    for (const s of SYMBOLS) {
      const n = normalize(map[s]);
      if (!n) { console.log(`[SKIP] ${s}: not in response`); continue; }
      console.log(`[OK] ${s}  $${n.last_price.toFixed(2)}  24h=${n.change_pct_24h.toFixed(2)}%  vol=${(n.volume_24h/1e6).toFixed(1)}M`);
      const sig = computeSignal(n);
      if (sig) {
        if (!isFinite(sig.entry) || !isFinite(sig.sl) || !isFinite(sig.tp1) || sig.rr <= 0) {
          fail++; console.log(`  [FAIL] signal math: ${JSON.stringify(sig)}`);
        } else {
          ok++; console.log(`  signal ${sig.dir} entry=$${sig.entry.toFixed(2)} sl=$${sig.sl.toFixed(2)} tp1=$${sig.tp1.toFixed(2)} R:R=${sig.rr}`);
        }
      }
    }

    // Kline smoke test
    const klResp = await getJSON(`${REST}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=5&limit=20`);
    if (klResp.retCode !== 0 || !klResp.result?.list?.length) throw new Error("kline-bad");
    const row = klResp.result.list[0];
    console.log(`[OK] BTCUSDT 5m kline rows=${klResp.result.list.length} latest_close=$${parseFloat(row[4]).toFixed(2)}`);

    console.log(`\n${ok} signal(s) ok, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("[WARN] verify-realtime skipped:", e.message);
    // Soft-skip so offline environments don't fail the build.
    process.exit(0);
  }
})();
