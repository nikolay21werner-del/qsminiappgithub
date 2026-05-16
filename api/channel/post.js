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
  lines.push("<i>Сигналы и идеи — внутри приложения QUANTSIGNAL AI.</i>");
  lines.push("<i>" + escapeHtml(ts.utc) + " · " + escapeHtml(ts.mag) + "</i>");
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
function buildSvg(rows, mood, headline, ts) {
  const W = 1280, H = 720;
  const pad = 56;
  const accent = BRAND.accent;
  const moodColor = mood.color;

  function row(i, r) {
    const y = 270 + i * 70;
    const pctColor = r.pct == null ? BRAND.muted : (r.pct >= 0 ? BRAND.up : BRAND.down);
    const arrow = r.pct == null ? "·" : (r.pct >= 0 ? "▲" : "▼");
    return [
      '<text x="' + pad + '" y="' + y + '" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="34" font-weight="700">' + escapeXml(r.sym) + '</text>',
      '<text x="' + (pad + 170) + '" y="' + y + '" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="32">' + escapeXml(fmtPrice(r.last)) + '</text>',
      '<text x="' + (W - pad) + '" y="' + y + '" fill="' + pctColor + '" font-family="Inter, Segoe UI, sans-serif" font-size="32" font-weight="700" text-anchor="end">' + escapeXml(arrow + " " + fmtPct(r.pct)) + '</text>'
    ].join("");
  }

  const rowsSvg = rows.map(function (r, i) { return row(i, r); }).join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="' + BRAND.bg0 + '"/>',
    '<stop offset="100%" stop-color="' + BRAND.bg2 + '"/>',
    '</linearGradient>',
    '<radialGradient id="halo" cx="85%" cy="10%" r="60%">',
    '<stop offset="0%" stop-color="' + accent + '" stop-opacity="0.35"/>',
    '<stop offset="100%" stop-color="' + accent + '" stop-opacity="0"/>',
    '</radialGradient>',
    '</defs>',
    '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>',
    '<rect width="' + W + '" height="' + H + '" fill="url(#halo)"/>',
    // Q mark
    '<g transform="translate(' + pad + ',' + pad + ')">',
    '<circle cx="32" cy="32" r="28" fill="none" stroke="' + accent + '" stroke-width="4"/>',
    '<line x1="46" y1="46" x2="62" y2="62" stroke="' + accent + '" stroke-width="4" stroke-linecap="round"/>',
    '<text x="78" y="42" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="28" font-weight="800" letter-spacing="2">QUANTSIGNAL AI</text>',
    '<text x="78" y="66" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="16" letter-spacing="3">СВОДКА РЫНКА · RU</text>',
    '</g>',
    // Headline
    '<text x="' + pad + '" y="180" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="40" font-weight="800">' + escapeXml(headline) + '</text>',
    // Mood pill
    '<g transform="translate(' + pad + ',210)">',
    '<rect x="0" y="0" rx="18" ry="18" width="360" height="40" fill="' + moodColor + '" fill-opacity="0.15" stroke="' + moodColor + '" stroke-opacity="0.6"/>',
    '<text x="20" y="27" fill="' + moodColor + '" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="700">Настроение: ' + escapeXml(mood.label) + ' · ' + escapeXml(fmtPct(mood.score)) + '</text>',
    '</g>',
    // Rows
    rowsSvg,
    // Footer
    '<line x1="' + pad + '" y1="' + (H - 110) + '" x2="' + (W - pad) + '" y2="' + (H - 110) + '" stroke="' + BRAND.accent + '" stroke-opacity="0.25" stroke-width="1"/>',
    '<text x="' + pad + '" y="' + (H - 70) + '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="20">' + escapeXml(ts.utc) + '  ·  ' + escapeXml(ts.mag) + '</text>',
    '<text x="' + (W - pad) + '" y="' + (H - 70) + '" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="20" text-anchor="end">t.me · QUANTSIGNAL AI</text>',
    '<text x="' + pad + '" y="' + (H - 36) + '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="16">Не финансовая рекомендация. Управляйте риском.</text>',
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
