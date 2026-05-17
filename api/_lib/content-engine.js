/* =========================================================
   QUANTSIGNAL AI — Content Engine.

   Generates Telegram post plans for a small library of post types:
     - market_update : daily snapshot of BTC/ETH/SOL/TON/DOGE
     - signal_idea   : single-symbol trade idea (entry/stop/targets)
     - coin_focus    : deep-dive on one symbol with risk + plan
     - ai_radar      : multi-symbol "what's interesting right now" digest

   Each plan returns:
     {
       type, symbol, mood, headline, caption_html, snapshot,
       hero, warnings
     }

   The captions are deterministic Russian by default (no external AI
   dependency) so latency is bounded and the post pipeline never blocks
   on a model. If an upstream AI provider is wired via /api/ai/chat the
   caller can layer that on top — the content engine itself stays
   provider-free for stability.
   ========================================================= */
"use strict";

const market = require("./market");

const BRAND_TAG = "QUANTSIGNAL AI";
const BOT_URL = "https://t.me/QUANTSIGNAL_AI_BOT";
const BOT_CTA_HTML = '<a href="' + BOT_URL + '">Сигналы QUANTSIGNAL AI</a>';
const DISCLAIMER = "⚠️ Не финансовая рекомендация. Управляйте риском.";

const TYPES = ["market_update", "signal_idea", "coin_focus", "ai_radar"];

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
  const weights = { BTC: 3, ETH: 2, SOL: 1, TON: 1, DOGE: 1 };
  let wsum = 0, w = 0;
  for (const r of rows) {
    if (r.pct == null) continue;
    const k = weights[r.sym] || 1;
    wsum += r.pct * k; w += k;
  }
  const avg = w ? wsum / w : 0;
  if (avg >= 1.5) return { key: "bullish", label: "Бычий", score: avg };
  if (avg <= -1.5) return { key: "bearish", label: "Медвежий", score: avg };
  return { key: "neutral", label: "Нейтральный", score: avg };
}

function pickHero(rows, preferred) {
  if (preferred) {
    const p = rows.find(function (r) { return r.sym === preferred; });
    if (p && p.last != null) return p;
  }
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
  return best || rows[0] || { sym: "BTC", last: null, pct: null };
}

function confidenceFor(hero) {
  // Confidence is a function of |pct| capped at ~3.5%.
  if (!hero || hero.pct == null) return { key: "low", label: "низкая" };
  const a = Math.abs(hero.pct);
  if (a >= 3) return { key: "high", label: "высокая" };
  if (a >= 1.2) return { key: "medium", label: "средняя" };
  return { key: "low", label: "низкая" };
}

function riskFor(hero) {
  if (!hero || hero.pct == null) return { key: "medium", label: "средний" };
  const a = Math.abs(hero.pct);
  if (a >= 4) return { key: "high", label: "повышенный" };
  if (a <= 0.6) return { key: "low", label: "сдержанный" };
  return { key: "medium", label: "средний" };
}

function biasLabel(hero) {
  if (!hero || hero.pct == null) return "Нейтральный";
  if (hero.pct >= 0.6) return "Бычий";
  if (hero.pct <= -0.6) return "Медвежий";
  return "Нейтральный";
}

function levelsFor(hero) {
  // Build conservative entry/stop/target levels derived from the 24h
  // range. We do NOT pretend to know intraday data — these are
  // structural levels suitable for a published idea.
  if (!hero || hero.last == null) {
    return { entry: null, stop: null, t1: null, t2: null };
  }
  const last = hero.last;
  const pct = hero.pct == null ? 0 : hero.pct;
  const hi = hero.high != null ? hero.high : last * 1.02;
  const lo = hero.low != null ? hero.low : last * 0.98;
  const range = Math.max(1e-9, hi - lo);
  const bull = pct >= 0;
  // Entry pulls back ~25% of the daily range from current price.
  const entry = bull ? last - range * 0.25 : last + range * 0.25;
  const stop  = bull ? lo - range * 0.10  : hi + range * 0.10;
  const t1    = bull ? last + range * 0.50 : last - range * 0.50;
  const t2    = bull ? last + range * 1.00 : last - range * 1.00;
  return { entry: entry, stop: stop, t1: t1, t2: t2 };
}

// ---------- Headlines ----------
function headlineMarket(mood, rows) {
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

function headlineSignal(hero) {
  const bias = biasLabel(hero);
  if (bias === "Бычий") return hero.sym + ": импульс смещается на сторону покупателей";
  if (bias === "Медвежий") return hero.sym + ": продавцы дожимают актив — план на отскок";
  return hero.sym + ": компрессия перед движением — план на пробой";
}

function headlineFocus(hero) {
  return hero.sym + ": разбор и сценарий на ближайшую сессию";
}

function headlineRadar(rows) {
  const movers = rows.filter(function (r) { return r.pct != null; })
    .sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); })
    .slice(0, 2)
    .map(function (r) { return r.sym; });
  if (!movers.length) return "Радар QUANTSIGNAL AI: сканируем рынок";
  return "Радар QUANTSIGNAL AI: " + movers.join(" / ") + " под прицелом";
}

// ---------- Captions ----------
function captionMarketUpdate(rows, mood, headline) {
  const lines = [];
  lines.push("🛰 <b>" + BRAND_TAG + " · Сводка рынка</b>");
  lines.push("");
  lines.push("<b>" + escapeHtml(headline) + "</b>");
  lines.push("Настроение: <b>" + escapeHtml(mood.label) + "</b> · средн. " + fmtPct(mood.score));
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
  lines.push(narrativeMarket(rows, mood));
  lines.push("");
  lines.push(BOT_CTA_HTML);
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

function captionSignalIdea(hero, conf, risk) {
  const lv = levelsFor(hero);
  const bias = biasLabel(hero);
  const lines = [];
  lines.push("🎯 <b>" + BRAND_TAG + " · Сигнал-идея</b>");
  lines.push("");
  lines.push("<b>" + escapeHtml(hero.sym + "USDT") + "</b> · " + escapeHtml(fmtPrice(hero.last)) +
    " · " + escapeHtml(fmtPct(hero.pct)));
  lines.push("Bias: <b>" + escapeHtml(bias) + "</b> (уверенность: " + escapeHtml(conf.label) + ")");
  lines.push("Риск: <b>" + escapeHtml(risk.label) + "</b>");
  lines.push("");
  lines.push("План:");
  lines.push("• Вход: " + escapeHtml(fmtPrice(lv.entry)));
  lines.push("• Стоп: " + escapeHtml(fmtPrice(lv.stop)));
  lines.push("• Цель 1: " + escapeHtml(fmtPrice(lv.t1)));
  lines.push("• Цель 2: " + escapeHtml(fmtPrice(lv.t2)));
  lines.push("");
  lines.push(narrativeSignal(hero, bias));
  lines.push("");
  lines.push(BOT_CTA_HTML);
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

function captionCoinFocus(hero, conf, risk) {
  const bias = biasLabel(hero);
  const lines = [];
  lines.push("🔎 <b>" + BRAND_TAG + " · Разбор " + escapeHtml(hero.sym) + "</b>");
  lines.push("");
  lines.push("<b>" + escapeHtml(hero.sym + "USDT") + "</b> · " + escapeHtml(fmtPrice(hero.last)) +
    " · " + escapeHtml(fmtPct(hero.pct)));
  lines.push("Bias: <b>" + escapeHtml(bias) + "</b> (уверенность: " + escapeHtml(conf.label) + ")");
  lines.push("Риск: <b>" + escapeHtml(risk.label) + "</b>");
  if (hero.high != null && hero.low != null) {
    lines.push("Диапазон 24ч: " + escapeHtml(fmtPrice(hero.low)) + " — " + escapeHtml(fmtPrice(hero.high)));
  }
  lines.push("");
  lines.push(narrativeFocus(hero, bias));
  lines.push("");
  lines.push("Что смотреть дальше:");
  lines.push("• Объём на пробое — без него движение не подтверждено.");
  lines.push("• Реакцию у границ диапазона — там решается приоритет.");
  lines.push("• Корреляцию с BTC — альты обычно следуют за лидером.");
  lines.push("");
  lines.push(BOT_CTA_HTML);
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

function captionAiRadar(rows, mood) {
  const headline = headlineRadar(rows);
  const sorted = rows.slice().sort(function (a, b) {
    const aa = a.pct == null ? -1 : Math.abs(a.pct);
    const bb = b.pct == null ? -1 : Math.abs(b.pct);
    return bb - aa;
  });
  const lines = [];
  lines.push("📡 <b>" + BRAND_TAG + " · Радар</b>");
  lines.push("");
  lines.push("<b>" + escapeHtml(headline) + "</b>");
  lines.push("Настроение: <b>" + escapeHtml(mood.label) + "</b> · средн. " + fmtPct(mood.score));
  lines.push("");
  for (const r of sorted.slice(0, 5)) {
    const arrow = r.pct == null ? "·" : (r.pct >= 0 ? "▲" : "▼");
    const tag = r.pct == null ? "—" :
      Math.abs(r.pct) >= 3 ? "сильное движение" :
      Math.abs(r.pct) >= 1.2 ? "локальный импульс" : "тихий режим";
    lines.push(
      "• <b>" + escapeHtml(r.sym) + "</b> " +
      escapeHtml(fmtPrice(r.last)) + "  " + arrow + " " +
      escapeHtml(fmtPct(r.pct)) + " · " + escapeHtml(tag)
    );
  }
  lines.push("");
  lines.push(narrativeRadar(sorted, mood));
  lines.push("");
  lines.push(BOT_CTA_HTML);
  lines.push("");
  lines.push(DISCLAIMER);
  return lines.join("\n");
}

// ---------- Narratives ----------
function narrativeMarket(rows, mood) {
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

function narrativeSignal(hero, bias) {
  const pieces = [];
  if (bias === "Бычий") {
    pieces.push("Покупатели контролируют инициативу — берём идею от поддержки, а не в погоне.");
    pieces.push("Подтверждение — закрытие свечи выше зоны входа на повышенном объёме.");
  } else if (bias === "Медвежий") {
    pieces.push("Продавцы доминируют — отрабатываем отскок к сопротивлению или продолжение вниз.");
    pieces.push("Подтверждение — отказ выше зоны входа со снижающимся объёмом.");
  } else {
    pieces.push("Рынок в балансе — план на пробой границы диапазона с подтверждением объёмом.");
    pieces.push("Без объёма входа нет — не догоняем первую свечу.");
  }
  pieces.push("Размер позиции — от стопа, не от прибыли. Идея отменяется при пробое стопа.");
  return pieces.join(" ");
}

function narrativeFocus(hero, bias) {
  const pieces = [];
  if (bias === "Бычий") {
    pieces.push("Импульс смещается на сторону покупателей, структура краткосрочно бычья.");
  } else if (bias === "Медвежий") {
    pieces.push("Давление продавцов сохраняется, локальные отскоки — продаём силу, не покупаем слабость.");
  } else {
    pieces.push("Цена консолидируется — решение принимается на границе диапазона, а не внутри.");
  }
  pieces.push("Ключевой триггер — объём на ключевых уровнях. Без объёма движение быстро затухает.");
  return pieces.join(" ");
}

function narrativeRadar(sorted, mood) {
  const top = sorted[0];
  if (!top || top.pct == null) {
    return "Сильных движений нет — рынок остывает, ждём катализатор.";
  }
  if (Math.abs(top.pct) >= 3) {
    return top.sym + " — лидер по волатильности; следим за объёмом и реакцией у уровней.";
  }
  if (mood.key === "neutral") {
    return "Локальные импульсы есть, но широкого тренда нет. Торгуем точечно по плану.";
  }
  return "Импульс распределён по нескольким активам — рассматриваем ротацию, а не one-shot идеи.";
}

// ---------- Plan API ----------
async function planForType(type, opts) {
  const options = opts || {};
  const list = options.symbols && options.symbols.length
    ? options.symbols : market.SYMBOLS;
  const snap = await market.fetchSnapshot(list);
  const rows = snap.rows;
  const warnings = snap.warnings.slice();
  const mood = moodFor(rows);
  const preferred = options.symbol || null;
  const hero = pickHero(rows, preferred);
  const conf = confidenceFor(hero);
  const risk = riskFor(hero);

  let headline = "";
  let caption_html = "";

  switch (type) {
    case "signal_idea":
      headline = headlineSignal(hero);
      caption_html = captionSignalIdea(hero, conf, risk);
      break;
    case "coin_focus":
      headline = headlineFocus(hero);
      caption_html = captionCoinFocus(hero, conf, risk);
      break;
    case "ai_radar":
      headline = headlineRadar(rows);
      caption_html = captionAiRadar(rows, mood);
      break;
    case "market_update":
    default:
      headline = headlineMarket(mood, rows);
      caption_html = captionMarketUpdate(rows, mood, headline);
      break;
  }

  if (hero.last == null) warnings.push("hero_no_price:" + hero.sym);

  return {
    type: TYPES.indexOf(type) >= 0 ? type : "market_update",
    symbol: hero.sym,
    mood: mood,
    headline: headline,
    caption_html: caption_html,
    hero: hero,
    confidence: conf,
    risk: risk,
    snapshot: rows,
    brand: BRAND_TAG,
    bot_url: BOT_URL,
    warnings: warnings
  };
}

module.exports = {
  TYPES: TYPES,
  BRAND_TAG: BRAND_TAG,
  BOT_URL: BOT_URL,
  DISCLAIMER: DISCLAIMER,
  planForType: planForType,
  escapeHtml: escapeHtml,
  fmtPrice: fmtPrice,
  fmtPct: fmtPct,
  moodFor: moodFor,
  pickHero: pickHero,
  biasLabel: biasLabel,
  confidenceFor: confidenceFor,
  riskFor: riskFor,
  levelsFor: levelsFor
};
