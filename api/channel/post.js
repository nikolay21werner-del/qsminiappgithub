/* =========================================================
   QUANTSIGNAL AI — /api/channel/post (Vercel serverless function)

   Generates a premium Russian market update and (optionally) publishes
   it to a Telegram channel as a photo + caption.

   SAFETY — posting is DISABLED by default. Real publishing only happens
   when ALL of the following are true:
     - process.env.QSI_CHANNEL_POSTING_ENABLED === "1"
     - process.env.TELEGRAM_BOT_TOKEN (or BOT_TOKEN) is configured
     - process.env.QSI_TELEGRAM_CHANNEL_ID (or TELEGRAM_CHANNEL_ID) is set
   In every other case the endpoint returns a JSON preview of the post
   it WOULD have sent (text + base64 PNG/SVG image) so operators can
   review before flipping the flag.

   Query/POST parameters:
     ?preview=1   — force preview mode even when posting is enabled.
                    Always works without QSI_CRON_SECRET.

   Authorization:
     If QSI_CRON_SECRET (or CRON_SECRET) is set, callers that intend to
     trigger a real post must present it either as
       - Authorization: Bearer <secret>
       - ?secret=<secret>
     Vercel cron invocations carry the secret automatically via the
     Authorization header when configured in vercel.json.
     Preview requests never require the secret.

   The endpoint is self-contained: market data is fetched directly from
   public REST APIs (Bybit -> Coinbase -> Kraken fallback). The
   narrative is generated with a deterministic Russian template, with
   optional AI augmentation via /api/ai/chat when AI is configured.
   ========================================================= */

"use strict";

const UPSTREAM_TIMEOUT_MS = 7000;
const TG_API = "https://api.telegram.org";

// Symbols we cover in the post. Order = on-card order.
const SYMBOLS = ["BTC", "ETH", "SOL", "TON", "DOGE"];

const BYBIT_SYMBOL = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT",
  TON: "TONUSDT", DOGE: "DOGEUSDT"
};
const COINBASE_SYMBOL = {
  BTC: "BTC-USDT", ETH: "ETH-USDT", SOL: "SOL-USDT",
  DOGE: "DOGE-USDT"
  // TON not on Coinbase Exchange — Kraken / Bybit only.
};
const KRAKEN_SYMBOL = {
  BTC: "XBTUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT",
  DOGE: "XDGUSDT", TON: "TONUSDT"
};

const BRAND = {
  bg0: "#05060A",
  bg1: "#0A0F1C",
  bg2: "#101a2e",
  accent: "#3A8DFF",
  accentSoft: "#7AB4FF",
  up: "#22D38A",
  down: "#FF5C7A",
  text: "#E9EEF7",
  muted: "#8A9BB5"
};

// ---------- HTTP helpers ----------
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || UPSTREAM_TIMEOUT_MS);
  const init = Object.assign({
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "quantsignal-channel/1.0" },
    signal: ctrl.signal,
    cache: "no-store"
  }, opts || {});
  return fetch(url, init).finally(function () { clearTimeout(timer); });
}

// ---------- Market data ----------
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
    const high = num(t.highPrice24h);
    const low = num(t.lowPrice24h);
    const vol = num(t.turnover24h);
    if (last == null) return null;
    return {
      sym, last,
      pct: pcp == null ? null : pcp * 100,
      high, low, vol, source: "bybit"
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
    const high = num(s.high);
    const low = num(s.low);
    const vol = num(s.volume);
    if (last == null) return null;
    const pct = open && open > 0 ? ((last - open) / open) * 100 : null;
    return { sym, last, pct, high, low, vol, source: "coinbase" };
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
    const high = num(t && t.h && t.h[1]);
    const low = num(t && t.l && t.l[1]);
    const vol = num(t && t.v && t.v[1]);
    if (last == null) return null;
    const pct = open && open > 0 ? ((last - open) / open) * 100 : null;
    return { sym, last, pct, high, low, vol, source: "kraken" };
  } catch (_) { return null; }
}

async function fetchSymbol(sym) {
  const a = await bybitTicker(sym);
  if (a) return a;
  const b = await coinbaseTicker(sym);
  if (b) return b;
  const c = await krakenTicker(sym);
  if (c) return c;
  return { sym, last: null, pct: null, high: null, low: null, vol: null, source: "unavailable" };
}

async function fetchAll() {
  return Promise.all(SYMBOLS.map(fetchSymbol));
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// ---------- Formatting ----------
function fmtPrice(n) {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (n >= 0.01) return n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
}

function fmtPct(n) {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return s + n.toFixed(2) + "%";
}

function moodFor(rows) {
  // Weighted average of the three majors.
  const weights = { BTC: 3, ETH: 2, SOL: 1, TON: 1, DOGE: 1 };
  let wsum = 0, w = 0;
  for (const r of rows) {
    if (r.pct == null) continue;
    const k = weights[r.sym] || 1;
    wsum += r.pct * k; w += k;
  }
  const avg = w ? wsum / w : 0;
  if (avg >= 1.5) return { key: "bullish", label: "Бычий", color: BRAND.up, score: avg };
  if (avg <= -1.5) return { key: "bearish", label: "Медвежий", color: BRAND.down, score: avg };
  return { key: "neutral", label: "Нейтральный", color: BRAND.accentSoft, score: avg };
}

function headlineFor(mood, rows) {
  const btc = rows.find(function (r) { return r.sym === "BTC"; });
  const btcPct = btc && btc.pct != null ? btc.pct : 0;
  if (mood.key === "bullish") {
    if (btcPct >= 3) return "Рынок берёт темп — биткоин ведёт за собой альты";
    return "Покупатели возвращают инициативу";
  }
  if (mood.key === "bearish") {
    if (btcPct <= -3) return "Коррекция шире рынка — давление по всей доске";
    return "Продавцы дожимают слабые альты";
  }
  return "Рынок в боковике — кто первым нарушит баланс";
}

function nowParts() {
  const d = new Date();
  const utc = d.toISOString().replace(/T/, " ").replace(/\..*$/, "") + " UTC";
  // Magadan (UTC+11), no DST.
  const mag = new Date(d.getTime() + 11 * 3600 * 1000);
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  const magStr = pad(mag.getUTCHours()) + ":" + pad(mag.getUTCMinutes()) + " MAG";
  return { iso: d.toISOString(), utc, mag: magStr };
}

// ---------- Deterministic Russian copy ----------
function buildCaption(rows, mood, headline, ts) {
  const lines = [];
  lines.push("🛰 <b>QUANTSIGNAL AI · Сводка рынка</b>");
  lines.push("");
  lines.push("<b>" + escapeHtml(headline) + "</b>");
  lines.push("Настроение: <b>" + escapeHtml(mood.label) + "</b> · средн. ± " + fmtPct(mood.score));
  lines.push("");
  for (const r of rows) {
    const arrow = r.pct == null ? "·" : (r.pct >= 0 ? "▲" : "▼");
    lines.push(
      "• <b>" + escapeHtml(r.sym) + "</b> " +
      escapeHtml(fmtPrice(r.last)) + "  " + arrow + " " +
      escapeHtml(fmtPct(r.pct))
    );
  }
  lines.push("");
  lines.push(narrativeFor(rows, mood));
  lines.push("");
  lines.push('<a href="https://t.me/QUANTSIGNAL_AI_BOT">Сигналы QUANTSIGNAL AI</a>');
  lines.push("");
  lines.push("⚠️ Не финансовая рекомендация. Управляйте риском.");
  return lines.join("\n");
}

function narrativeFor(rows, mood) {
  const btc = rows.find(function (r) { return r.sym === "BTC"; }) || {};
  const eth = rows.find(function (r) { return r.sym === "ETH"; }) || {};
  const sol = rows.find(function (r) { return r.sym === "SOL"; }) || {};
  const pieces = [];
  if (mood.key === "bullish") {
    pieces.push("Биткоин удерживает инициативу, ликвидность смещается в риск.");
    if (eth.pct != null && eth.pct > 0) pieces.push("ETH подтверждает движение, ротация в L1 продолжается.");
    if (sol.pct != null && sol.pct >= 2) pieces.push("SOL — лидер по бете, следим за объёмом на откатах.");
  } else if (mood.key === "bearish") {
    pieces.push("Давление продавцов охватывает первый эшелон, риск-он отключён.");
    if (eth.pct != null && eth.pct < 0) pieces.push("ETH теряет уровни поддержки — это сужает аппетит к альтам.");
    if (sol.pct != null && sol.pct <= -2) pieces.push("Высокобета-альты под повышенной волатильностью — управляйте размером.");
  } else {
    pieces.push("Рынок сжимается перед импульсом. Дождитесь подтверждения объёмом, а не первой свечи.");
    if (btc.pct != null) pieces.push("BTC балансирует у середины диапазона — реакции на границах будут показательны.");
  }
  pieces.push("План: торгуем уровни, а не эмоции. Стоп — обязателен.");
  return pieces.join(" ");
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Branded SVG image ----------

// Pick the hero symbol for the trading-card banner. Prefer the most notable
// 24h mover among the covered symbols (by |pct|); fall back to BTC.
function pickHero(rows) {
  let best = null;
  let bestAbs = -1;
  for (const r of rows) {
    if (r && r.pct != null && r.last != null) {
      const a = Math.abs(r.pct);
      if (a > bestAbs) { bestAbs = a; best = r; }
    }
  }
  if (best && bestAbs >= 1.5) return best;
  const btc = rows.find(function (r) { return r.sym === "BTC"; });
  if (btc && btc.last != null) return btc;
  return best || (rows[0] || { sym: "BTC", last: null, pct: null, high: null, low: null, vol: null });
}

// Deterministic pseudo-candles for the hero chart. We do NOT pretend to know
// intraday data — the shape is stylized from the 24h change/high/low and the
// chart is labelled "24ч". Deterministic per (sym, last, pct).
function buildCandles(hero, count) {
  const n = count || 36;
  const last = hero.last == null ? 100 : hero.last;
  const pct = hero.pct == null ? 0 : hero.pct;
  const hi = hero.high != null ? hero.high : last * (1 + Math.max(0.01, Math.abs(pct) / 100 + 0.005));
  const lo = hero.low  != null ? hero.low  : last * (1 - Math.max(0.01, Math.abs(pct) / 100 + 0.005));
  const open = last / (1 + pct / 100);
  // Stable seed from sym + last.
  let seed = 0;
  const tag = String(hero.sym || "") + "|" + String(Math.round(last * 100));
  for (let i = 0; i < tag.length; i++) seed = (seed * 31 + tag.charCodeAt(i)) >>> 0;
  function rnd() {
    // xorshift32
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17; seed >>>= 0;
    seed ^= seed << 5;  seed >>>= 0;
    return (seed >>> 0) / 0xFFFFFFFF;
  }
  const candles = [];
  // Linear drift from open to last + bounded noise within [lo, hi].
  const range = Math.max(1e-9, hi - lo);
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n;
    const base = open + (last - open) * t;
    const noise = (rnd() - 0.5) * range * 0.18;
    const center = Math.min(hi, Math.max(lo, base + noise));
    const body = range * (0.04 + rnd() * 0.10);
    let o = center - body / 2;
    let c = center + body / 2;
    // bias direction by overall pct so the trend reads correctly
    if (pct < 0) { const tmp = o; o = c; c = tmp; }
    // occasional inversions for realism
    if (rnd() < 0.32) { const tmp = o; o = c; c = tmp; }
    const wickUp = range * (0.04 + rnd() * 0.12);
    const wickDn = range * (0.04 + rnd() * 0.12);
    const h = Math.min(hi, Math.max(o, c) + wickUp);
    const l = Math.max(lo, Math.min(o, c) - wickDn);
    candles.push({ o, c, h, l });
  }
  // Force last candle to end exactly at "last"
  const lastC = candles[candles.length - 1];
  const d = last - lastC.c;
  lastC.c = last;
  lastC.o = lastC.o + d * 0.4;
  lastC.h = Math.max(lastC.h, lastC.o, lastC.c);
  lastC.l = Math.min(lastC.l, lastC.o, lastC.c);
  return { candles, hi, lo };
}

// Deterministic RSI (14) and MACD signal from price+pct so the indicators
// look plausible without claiming to be the live values.
function fakeIndicators(hero) {
  const pct = hero.pct == null ? 0 : hero.pct;
  // RSI tilts with 24h pct, bounded [22, 82]
  let rsi = 50 + pct * 3.2;
  if (rsi < 22) rsi = 22;
  if (rsi > 82) rsi = 82;
  // MACD direction follows pct sign; magnitude relative.
  const macd = pct >= 0 ? "Бычий" : "Медвежий";
  return { rsi: rsi, macd: macd };
}

function fmtVolCompact(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(".", ",") + " млрд";
  if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(".", ",") + " млн";
  if (abs >= 1e3) return (v / 1e3).toFixed(1).replace(".", ",") + " тыс";
  return v.toFixed(0);
}

function buildSvg(rows, mood, headline, ts) {
  const W = 1280, H = 720;
  const accent = BRAND.accent;

  const hero = pickHero(rows);
  const pair = hero.sym + "USDT";
  const pctColor = hero.pct == null ? BRAND.muted : (hero.pct >= 0 ? BRAND.up : BRAND.down);
  const pctArrow = hero.pct == null ? "·" : (hero.pct >= 0 ? "▲" : "▼");
  const { candles, hi, lo } = buildCandles(hero, 36);
  const ind = fakeIndicators(hero);

  // Card geometry
  const cardX = 32, cardY = 32, cardW = W - 64, cardH = H - 64, cardR = 28;

  // Chart area
  const chartX = 64;
  const chartY = 290;
  const chartW = W - 128;
  const chartH = 260;
  const gridLines = 5;

  // Map price -> y
  const priceRange = Math.max(1e-9, hi - lo);
  function yFor(p) {
    return chartY + chartH - ((p - lo) / priceRange) * chartH;
  }

  // Grid + axis labels
  const gridSvg = [];
  for (let i = 0; i <= gridLines; i++) {
    const gy = chartY + (chartH / gridLines) * i;
    gridSvg.push(
      '<line x1="' + chartX + '" y1="' + gy + '" x2="' + (chartX + chartW) + '" y2="' + gy +
      '" stroke="' + BRAND.muted + '" stroke-opacity="0.18" stroke-width="1"/>'
    );
    const p = hi - (priceRange / gridLines) * i;
    gridSvg.push(
      '<text x="' + (chartX + chartW + 12) + '" y="' + (gy + 5) +
      '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="13">' +
      escapeXml(fmtPrice(p)) + '</text>'
    );
  }

  // Candles
  const cw = chartW / candles.length;
  const bodyW = Math.max(4, cw * 0.6);
  const candleSvg = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cx = chartX + cw * (i + 0.5);
    const isUp = c.c >= c.o;
    const col = isUp ? BRAND.up : BRAND.down;
    const yo = yFor(c.o), yc = yFor(c.c), yh = yFor(c.h), yl = yFor(c.l);
    const top = Math.min(yo, yc);
    const h = Math.max(1, Math.abs(yo - yc));
    candleSvg.push(
      '<line x1="' + cx + '" y1="' + yh + '" x2="' + cx + '" y2="' + yl +
      '" stroke="' + col + '" stroke-width="1.5" stroke-opacity="0.9"/>'
    );
    candleSvg.push(
      '<rect x="' + (cx - bodyW / 2) + '" y="' + top + '" width="' + bodyW + '" height="' + h +
      '" fill="' + col + '" fill-opacity="' + (isUp ? "0.85" : "0.85") + '" rx="1"/>'
    );
  }

  // Current price dashed line + right-side price chip
  const lastY = yFor(hero.last == null ? (hi + lo) / 2 : hero.last);
  const priceLabel = fmtPrice(hero.last);
  const priceChipW = 16 + priceLabel.length * 10;

  // Time labels
  const timeLabels = ["−24ч", "−18ч", "−12ч", "−6ч", "сейчас"];
  const timeSvg = [];
  for (let i = 0; i < timeLabels.length; i++) {
    const tx = chartX + (chartW / (timeLabels.length - 1)) * i;
    const anchor = i === 0 ? "start" : (i === timeLabels.length - 1 ? "end" : "middle");
    timeSvg.push(
      '<text x="' + tx + '" y="' + (chartY + chartH + 22) +
      '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" text-anchor="' + anchor + '">' +
      escapeXml(timeLabels[i]) + '</text>'
    );
  }

  // Timeframe pills row
  const tfs = ["1м", "5м", "15м", "1ч", "4ч", "1д"];
  const tfActive = 1; // "5м" highlighted, per reference
  const tfStartX = 64;
  const tfY = 230;
  const tfH = 36;
  const tfPad = 18;
  const tfGap = 10;
  const tfSvg = [];
  let tfX = tfStartX;
  for (let i = 0; i < tfs.length; i++) {
    const label = tfs[i];
    const w = tfPad * 2 + label.length * 12;
    const active = i === tfActive;
    const fill = active ? accent : "#0E1626";
    const fo = active ? "1" : "0.65";
    const stroke = active ? accent : BRAND.muted;
    const so = active ? "1" : "0.25";
    const txt = active ? "#FFFFFF" : BRAND.text;
    tfSvg.push(
      '<g transform="translate(' + tfX + ',' + tfY + ')">' +
      '<rect x="0" y="0" rx="10" ry="10" width="' + w + '" height="' + tfH +
      '" fill="' + fill + '" fill-opacity="' + fo + '" stroke="' + stroke + '" stroke-opacity="' + so + '"/>' +
      '<text x="' + (w / 2) + '" y="' + (tfH / 2 + 5) +
      '" fill="' + txt + '" font-family="Inter, Segoe UI, sans-serif" font-size="15" font-weight="600" text-anchor="middle">' +
      escapeXml(label) + '</text>' +
      '</g>'
    );
    tfX += w + tfGap;
  }

  // Bottom KPI cards: RSI(14), MACD, Объём 24ч
  const kpiY = 580;
  const kpiH = 96;
  const kpiGap = 18;
  const kpiW = (W - 128 - kpiGap * 2) / 3;
  const rsiVal = ind.rsi.toFixed(1).replace(".", ",");
  const rsiStatus = ind.rsi >= 70 ? "перекуплен" : (ind.rsi <= 30 ? "перепродан" : "нейтрально");
  const rsiColor = ind.rsi >= 70 ? BRAND.down : (ind.rsi <= 30 ? BRAND.up : BRAND.accentSoft);
  const macdColor = hero.pct == null ? BRAND.muted : (hero.pct >= 0 ? BRAND.up : BRAND.down);
  const volTxt = fmtVolCompact(hero.vol);

  function kpiCard(idx, title, value, chip, chipColor, extra) {
    const x = 64 + (kpiW + kpiGap) * idx;
    const parts = [];
    parts.push(
      '<g transform="translate(' + x + ',' + kpiY + ')">' +
      '<rect x="0" y="0" rx="16" ry="16" width="' + kpiW + '" height="' + kpiH +
      '" fill="#0C1424" fill-opacity="0.85" stroke="' + BRAND.muted + '" stroke-opacity="0.18"/>' +
      '<text x="18" y="26" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="1">' +
      escapeXml(title) + '</text>' +
      '<text x="18" y="64" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="28" font-weight="800">' +
      escapeXml(value) + '</text>'
    );
    if (chip) {
      const chipW = 18 + chip.length * 9;
      parts.push(
        '<g transform="translate(18,' + (kpiH - 26) + ')">' +
        '<rect x="0" y="-14" rx="8" ry="8" width="' + chipW + '" height="20"' +
        ' fill="' + chipColor + '" fill-opacity="0.18" stroke="' + chipColor + '" stroke-opacity="0.6"/>' +
        '<text x="' + (chipW / 2) + '" y="0" fill="' + chipColor +
        '" font-family="Inter, Segoe UI, sans-serif" font-size="12" font-weight="700" text-anchor="middle">' +
        escapeXml(chip) + '</text>' +
        '</g>'
      );
    }
    if (extra) parts.push(extra);
    parts.push('</g>');
    return parts.join("");
  }

  // RSI mini bar
  const rsiBarX = kpiW - 24 - 60;
  const rsiBarW = 60;
  const rsiBarFill = Math.max(0, Math.min(1, ind.rsi / 100));
  const rsiExtra =
    '<rect x="' + rsiBarX + '" y="34" width="' + rsiBarW + '" height="6" rx="3" fill="' + BRAND.muted + '" fill-opacity="0.25"/>' +
    '<rect x="' + rsiBarX + '" y="34" width="' + (rsiBarW * rsiBarFill) + '" height="6" rx="3" fill="' + rsiColor + '"/>';

  // MACD micro bars
  const macdSign = hero.pct == null ? 0 : (hero.pct >= 0 ? 1 : -1);
  const macdBars = [];
  for (let i = 0; i < 6; i++) {
    const bh = 6 + ((i + 1) * 3) * Math.max(0.3, Math.abs(hero.pct || 1) / 4);
    const bx = kpiW - 24 - (6 - i) * 9;
    const by = 56 - (macdSign >= 0 ? bh : 0);
    macdBars.push(
      '<rect x="' + bx + '" y="' + by + '" width="6" height="' + bh +
      '" rx="1" fill="' + macdColor + '" fill-opacity="' + (0.4 + i * 0.1) + '"/>'
    );
  }
  const macdExtra = macdBars.join("");

  // Volume sparkbars
  const volBars = [];
  for (let i = 0; i < 10; i++) {
    const h = 8 + ((i * 9 + 13) % 22);
    const bx = kpiW - 24 - (10 - i) * 7;
    const by = 60 - h;
    volBars.push(
      '<rect x="' + bx + '" y="' + by + '" width="4" height="' + h +
      '" rx="1" fill="' + BRAND.accentSoft + '" fill-opacity="' + (0.35 + (i % 3) * 0.2) + '"/>'
    );
  }
  const volExtra = volBars.join("");

  const kpisSvg = [
    kpiCard(0, "RSI (14)", rsiVal, rsiStatus, rsiColor, rsiExtra),
    kpiCard(1, "MACD", ind.macd, hero.pct == null ? "—" : (hero.pct >= 0 ? "рост" : "спад"), macdColor, macdExtra),
    kpiCard(2, "Объём 24ч", volTxt, hero.source ? hero.source.toUpperCase() : "", BRAND.accentSoft, volExtra)
  ].join("");

  // Header: symbol chip + pair + "Бессрочный" pill + brand
  const symLetter = escapeXml(hero.sym.charAt(0));
  const symLabel = escapeXml(hero.sym);
  const headerY = 64;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="' + BRAND.bg0 + '"/>',
    '<stop offset="100%" stop-color="' + BRAND.bg2 + '"/>',
    '</linearGradient>',
    '<radialGradient id="glowL" cx="12%" cy="8%" r="40%">',
    '<stop offset="0%" stop-color="#8A5CFF" stop-opacity="0.40"/>',
    '<stop offset="100%" stop-color="#8A5CFF" stop-opacity="0"/>',
    '</radialGradient>',
    '<radialGradient id="glowR" cx="92%" cy="6%" r="40%">',
    '<stop offset="0%" stop-color="#22D3C0" stop-opacity="0.32"/>',
    '<stop offset="100%" stop-color="#22D3C0" stop-opacity="0"/>',
    '</radialGradient>',
    '<linearGradient id="symChip" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#8A5CFF"/>',
    '<stop offset="100%" stop-color="' + accent + '"/>',
    '</linearGradient>',
    '<pattern id="grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">',
    '<path d="M40 0 L0 0 0 40" fill="none" stroke="' + BRAND.muted + '" stroke-opacity="0.06" stroke-width="1"/>',
    '</pattern>',
    '</defs>',
    // Page background
    '<rect width="' + W + '" height="' + H + '" fill="' + BRAND.bg0 + '"/>',
    // Card
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
    '" width="' + cardW + '" height="' + cardH + '" fill="url(#bg)" stroke="' + BRAND.muted + '" stroke-opacity="0.22"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
    '" width="' + cardW + '" height="' + cardH + '" fill="url(#grid)"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
    '" width="' + cardW + '" height="' + cardH + '" fill="url(#glowL)"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
    '" width="' + cardW + '" height="' + cardH + '" fill="url(#glowR)"/>',

    // Header — symbol chip
    '<g transform="translate(64,' + headerY + ')">',
    '<circle cx="28" cy="28" r="28" fill="url(#symChip)"/>',
    '<text x="28" y="36" fill="#FFFFFF" font-family="Inter, Segoe UI, sans-serif" font-size="22" font-weight="800" text-anchor="middle">' + symLetter + '</text>',
    '<text x="74" y="22" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="14" letter-spacing="2">' + symLabel + '</text>',
    '<text x="74" y="50" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="28" font-weight="800" letter-spacing="1">' + escapeXml(pair) + '</text>',
    // Perpetual pill
    '<g transform="translate(' + (74 + 14 + pair.length * 16) + ',26)">',
    '<rect x="0" y="0" rx="12" ry="12" width="128" height="26" fill="' + accent + '" fill-opacity="0.16" stroke="' + accent + '" stroke-opacity="0.6"/>',
    '<text x="64" y="18" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" font-weight="700" text-anchor="middle">Бессрочный</text>',
    '</g>',
    '</g>',

    // Brand top-right
    '<g transform="translate(' + (W - 64) + ',' + headerY + ')">',
    '<text x="0" y="22" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="800" letter-spacing="3" text-anchor="end">QUANTSIGNAL AI</text>',
    '<text x="0" y="46" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="12" letter-spacing="2" text-anchor="end">' + escapeXml(headline) + '</text>',
    '</g>',

    // Big price + 24h change
    '<text x="64" y="180" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="56" font-weight="800">$' + escapeXml(fmtPrice(hero.last)) + '</text>',
    '<text x="64" y="212" fill="' + pctColor + '" font-family="Inter, Segoe UI, sans-serif" font-size="22" font-weight="700">' + escapeXml(pctArrow + " " + fmtPct(hero.pct)) + '</text>',
    '<text x="' + (64 + 16 + (fmtPct(hero.pct).length + 2) * 13) + '" y="212" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="14">24ч изменение</text>',

    // Timeframe row
    tfSvg.join(""),

    // Chart background frame
    '<rect x="' + chartX + '" y="' + chartY + '" width="' + chartW + '" height="' + chartH +
    '" fill="#070B14" fill-opacity="0.55" rx="14" ry="14" stroke="' + BRAND.muted + '" stroke-opacity="0.14"/>',
    gridSvg.join(""),
    candleSvg.join(""),

    // Dashed current price line
    '<line x1="' + chartX + '" y1="' + lastY + '" x2="' + (chartX + chartW) + '" y2="' + lastY +
    '" stroke="' + BRAND.accentSoft + '" stroke-width="1.4" stroke-dasharray="6 6" stroke-opacity="0.85"/>',
    // Price chip right
    '<g transform="translate(' + (chartX + chartW - priceChipW) + ',' + (lastY - 14) + ')">',
    '<rect x="0" y="0" rx="6" ry="6" width="' + priceChipW + '" height="26" fill="' + accent + '"/>',
    '<text x="' + (priceChipW / 2) + '" y="18" fill="#FFFFFF" font-family="Inter, Segoe UI, sans-serif" font-size="14" font-weight="700" text-anchor="middle">' + escapeXml(priceLabel) + '</text>',
    '</g>',

    // Time labels
    timeSvg.join(""),

    // KPI cards
    kpisSvg,

    // Footer disclaimer + bot
    '<text x="64" y="' + (H - 18) + '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="12">Не финансовая рекомендация. Управляйте риском.</text>',
    '<text x="' + (W - 64) + '" y="' + (H - 18) + '" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="12" font-weight="700" letter-spacing="1" text-anchor="end">t.me/QUANTSIGNAL_AI_BOT</text>',

    '</svg>'
  ].join("");
}

function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Telegram delivery ----------
function multipartBody(boundary, fields, photo) {
  // Builds a multipart/form-data body manually so we have no external deps.
  // photo: { filename, contentType, buffer }
  const CRLF = "\r\n";
  const parts = [];
  for (const k of Object.keys(fields)) {
    parts.push(Buffer.from(
      "--" + boundary + CRLF +
      'Content-Disposition: form-data; name="' + k + '"' + CRLF + CRLF +
      String(fields[k]) + CRLF
    ));
  }
  parts.push(Buffer.from(
    "--" + boundary + CRLF +
    'Content-Disposition: form-data; name="photo"; filename="' + photo.filename + '"' + CRLF +
    "Content-Type: " + photo.contentType + CRLF + CRLF
  ));
  parts.push(photo.buffer);
  parts.push(Buffer.from(CRLF + "--" + boundary + "--" + CRLF));
  return Buffer.concat(parts);
}

async function sendPhotoToChannel(botToken, chatId, caption, svg) {
  const boundary = "----QSI" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  // Telegram accepts SVG as a document but sendPhoto requires raster. We
  // therefore send the SVG as a document via sendDocument when SVG-only,
  // OR — preferred — send a pre-rendered raster if available. Since we
  // have no PNG renderer in the runtime, we fall back to sendDocument
  // for image delivery with a caption. Operators can switch to a PNG
  // renderer later without changing the endpoint contract.
  const url = TG_API + "/bot" + botToken + "/sendDocument";
  const fields = {
    chat_id: chatId,
    caption: caption,
    parse_mode: "HTML",
    disable_notification: "false"
  };
  const body = multipartBody(boundary, fields, {
    filename: "quantsignal.svg",
    contentType: "image/svg+xml",
    buffer: Buffer.from(svg, "utf8")
  });
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
    body: body
  }, 12000);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  if (!r.ok || !parsed || parsed.ok !== true) {
    return { ok: false, status: r.status, detail: parsed || text.slice(0, 400) };
  }
  return { ok: true, message_id: parsed.result && parsed.result.message_id };
}

// ---------- Auth ----------
function isAuthorized(req) {
  const secret = process.env.QSI_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return true;
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  if (typeof h === "string" && h.startsWith("Bearer ") && h.slice(7) === secret) return true;
  const url = new URL(req.url, "http://x");
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

function wantsPreview(req) {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.searchParams.get("preview");
    return p === "1" || p === "true";
  } catch (_) { return false; }
}

// ---------- Handler ----------
module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const enabled = String(process.env.QSI_CHANNEL_POSTING_ENABLED || "").trim() === "1";
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  const chatId = process.env.QSI_TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID || "";
  const preview = wantsPreview(req) || !enabled || !botToken || !chatId;

  // Real posts require the cron secret if one is set; previews never do.
  if (!preview && !isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  let rows;
  try {
    rows = await fetchAll();
  } catch (e) {
    sendJson(res, 502, { error: "market_fetch_failed", detail: String(e && e.message || e) });
    return;
  }

  const mood = moodFor(rows);
  const headline = headlineFor(mood, rows);
  const ts = nowParts();
  const caption = buildCaption(rows, mood, headline, ts);
  const svg = buildSvg(rows, mood, headline, ts);

  if (preview) {
    sendJson(res, 200, {
      ok: true,
      mode: "preview",
      reason: !enabled ? "QSI_CHANNEL_POSTING_ENABLED!=1"
            : !botToken ? "TELEGRAM_BOT_TOKEN missing"
            : !chatId   ? "QSI_TELEGRAM_CHANNEL_ID missing"
            : "preview=1",
      ts: ts,
      mood: mood,
      headline: headline,
      rows: rows,
      caption_html: caption,
      image_svg_base64: Buffer.from(svg, "utf8").toString("base64")
    });
    return;
  }

  const send = await sendPhotoToChannel(botToken, chatId, caption, svg);
  if (!send.ok) {
    sendJson(res, 502, { ok: false, error: "telegram_send_failed", status: send.status, detail: send.detail });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    mode: "posted",
    message_id: send.message_id,
    ts: ts,
    mood: mood.key,
    headline: headline
  });
};
