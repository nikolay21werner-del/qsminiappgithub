/* =========================================================
   QUANTSIGNAL AI — Programmatic branded image generator.

   Produces a deterministic SVG card matching the QUANTSIGNAL AI
   style: dark grid, cyan/orange accents, coin/pair, price, 24h
   change, bias + confidence + risk blocks, footer bot link.

   No external dependencies (sharp/satori/canvas are NOT required).
   The generator returns:
     - svg            : full SVG markup (UTF-8 string)
     - svg_base64     : base64-encoded UTF-8 SVG (data: friendly)
     - content_type   : "image/svg+xml"
     - data_url       : "data:image/svg+xml;base64,..." (drop-in <img src>)

   The canonical label JPEG at assets/telegram/quantsignal-label.jpeg
   remains the brand image actually uploaded via Telegram sendPhoto in
   api/channel/post.js — this generator is for previews and for any
   future raster pipeline that wants to layer raster on top.
   ========================================================= */
"use strict";

const BRAND = {
  bg0: "#05060A",
  bg1: "#0A0F1C",
  bg2: "#101a2e",
  accent: "#3A8DFF",
  accentSoft: "#7AB4FF",
  warn: "#FF8A3D",
  up: "#22D38A",
  down: "#FF5C7A",
  text: "#E9EEF7",
  muted: "#8A9BB5"
};

function escapeXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function typeLabel(type) {
  switch (type) {
    case "signal_idea": return "Сигнал-идея";
    case "coin_focus":  return "Разбор актива";
    case "ai_radar":    return "AI Радар";
    case "market_update":
    default:            return "Сводка рынка";
  }
}

function buildSvg(plan) {
  const W = 1280, H = 720;
  const hero = plan && plan.hero ? plan.hero : { sym: "BTC", last: null, pct: null };
  const pair = hero.sym + "USDT";
  const pctColor = hero.pct == null ? BRAND.muted : (hero.pct >= 0 ? BRAND.up : BRAND.down);
  const pctArrow = hero.pct == null ? "·" : (hero.pct >= 0 ? "▲" : "▼");
  const accent = BRAND.accent;

  // Bias / confidence / risk
  const bias = (plan && plan.confidence)
    ? (hero.pct == null ? "Нейтральный" : (hero.pct >= 0.6 ? "Бычий" : (hero.pct <= -0.6 ? "Медвежий" : "Нейтральный")))
    : "Нейтральный";
  const biasColor = bias === "Бычий" ? BRAND.up : (bias === "Медвежий" ? BRAND.down : BRAND.accentSoft);
  const conf = (plan && plan.confidence && plan.confidence.label) || "—";
  const risk = (plan && plan.risk && plan.risk.label) || "—";
  const riskColor = (plan && plan.risk && plan.risk.key === "high") ? BRAND.warn
    : (plan && plan.risk && plan.risk.key === "low") ? BRAND.up : BRAND.accentSoft;

  const headline = (plan && plan.headline) || "";
  const typeLbl = typeLabel(plan && plan.type);

  // Card geometry
  const cardX = 32, cardY = 32, cardW = W - 64, cardH = H - 64, cardR = 28;

  // Symbol chip + pair header (top-left)
  const symLetter = escapeXml(hero.sym.charAt(0));
  const symLabel = escapeXml(hero.sym);
  const headerY = 64;
  const pairFont = pair.length >= 8 ? 24 : (pair.length >= 7 ? 26 : 28);

  // Bias / confidence / risk blocks (bottom row)
  const blockY = 540;
  const blockH = 140;
  const blockGap = 18;
  const blockW = (W - 128 - blockGap * 2) / 3;

  function block(idx, title, value, sub, color) {
    const x = 64 + (blockW + blockGap) * idx;
    return [
      '<g transform="translate(' + x + ',' + blockY + ')">',
      '<rect x="0" y="0" rx="18" ry="18" width="' + blockW + '" height="' + blockH +
      '" fill="#0C1424" fill-opacity="0.92" stroke="' + BRAND.muted + '" stroke-opacity="0.22"/>',
      '<text x="22" y="32" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="2">' +
        escapeXml(title.toUpperCase()) + '</text>',
      '<text x="22" y="78" fill="' + color + '" font-family="Inter, Segoe UI, sans-serif" font-size="34" font-weight="800">' +
        escapeXml(value) + '</text>',
      '<text x="22" y="' + (blockH - 22) + '" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="14">' +
        escapeXml(sub) + '</text>',
      '</g>'
    ].join("");
  }

  // Hero price + 24h pct
  const priceText = fmtPrice(hero.last);
  const pctText = fmtPct(hero.pct);

  // Optional: levels (when available) shown to the right of the price
  let levelsBlock = "";
  if (plan && plan.type === "signal_idea") {
    const lv = plan && plan.levels ? plan.levels : null;
    if (lv) {
      const ly = 360;
      const lx = 64;
      const items = [
        ["Вход", fmtPrice(lv.entry), BRAND.accentSoft],
        ["Стоп", fmtPrice(lv.stop), BRAND.down],
        ["Цель 1", fmtPrice(lv.t1), BRAND.up],
        ["Цель 2", fmtPrice(lv.t2), BRAND.up]
      ];
      const itW = (W - 128 - 18 * 3) / 4;
      levelsBlock = items.map(function (it, i) {
        const xx = lx + (itW + 18) * i;
        return [
          '<g transform="translate(' + xx + ',' + ly + ')">',
          '<rect x="0" y="0" rx="14" ry="14" width="' + itW + '" height="100"',
          ' fill="#0E1626" fill-opacity="0.92" stroke="' + BRAND.muted + '" stroke-opacity="0.20"/>',
          '<text x="18" y="30" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="2">' +
            escapeXml(it[0].toUpperCase()) + '</text>',
          '<text x="18" y="72" fill="' + it[2] + '" font-family="Inter, Segoe UI, sans-serif" font-size="26" font-weight="800">' +
            escapeXml(it[1]) + '</text>',
          '</g>'
        ].join("");
      }).join("");
    }
  }

  // Multi-coin snapshot strip (for market_update + ai_radar)
  let stripBlock = "";
  if (plan && (plan.type === "market_update" || plan.type === "ai_radar") && Array.isArray(plan.snapshot)) {
    const rows = plan.snapshot.slice(0, 5);
    const sy = 360;
    const sx = 64;
    const stripW = (W - 128 - 16 * (rows.length - 1)) / rows.length;
    stripBlock = rows.map(function (r, i) {
      const xx = sx + (stripW + 16) * i;
      const col = r.pct == null ? BRAND.muted : (r.pct >= 0 ? BRAND.up : BRAND.down);
      const arrow = r.pct == null ? "·" : (r.pct >= 0 ? "▲" : "▼");
      return [
        '<g transform="translate(' + xx + ',' + sy + ')">',
        '<rect x="0" y="0" rx="14" ry="14" width="' + stripW + '" height="110"',
        ' fill="#0E1626" fill-opacity="0.92" stroke="' + BRAND.muted + '" stroke-opacity="0.20"/>',
        '<text x="18" y="30" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="12" letter-spacing="2">' +
          escapeXml(r.sym) + 'USDT</text>',
        '<text x="18" y="64" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="22" font-weight="800">' +
          escapeXml(fmtPrice(r.last)) + '</text>',
        '<text x="18" y="92" fill="' + col + '" font-family="Inter, Segoe UI, sans-serif" font-size="14" font-weight="700">' +
          escapeXml(arrow + " " + fmtPct(r.pct)) + '</text>',
        '</g>'
      ].join("");
    }).join("");
  }

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
    '<rect width="' + W + '" height="' + H + '" fill="' + BRAND.bg0 + '"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
      '" width="' + cardW + '" height="' + cardH + '" fill="url(#bg)" stroke="' + BRAND.muted + '" stroke-opacity="0.22"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
      '" width="' + cardW + '" height="' + cardH + '" fill="url(#grid)"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
      '" width="' + cardW + '" height="' + cardH + '" fill="url(#glowL)"/>',
    '<rect x="' + cardX + '" y="' + cardY + '" rx="' + cardR + '" ry="' + cardR +
      '" width="' + cardW + '" height="' + cardH + '" fill="url(#glowR)"/>',

    // Header: symbol chip + pair
    '<g transform="translate(64,' + headerY + ')">',
    '<circle cx="28" cy="28" r="28" fill="url(#symChip)"/>',
    '<text x="28" y="36" fill="#FFFFFF" font-family="Inter, Segoe UI, sans-serif" font-size="22" font-weight="800" text-anchor="middle">' + symLetter + '</text>',
    '<text x="74" y="22" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="14" letter-spacing="2">' + symLabel + '</text>',
    '<text x="74" y="50" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="' + pairFont + '" font-weight="800" letter-spacing="1">' + escapeXml(pair) + '</text>',
    '</g>',

    // Brand top-right + type pill
    '<g transform="translate(' + (W - 64) + ',' + headerY + ')">',
    '<text x="0" y="22" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="800" letter-spacing="3" text-anchor="end">QUANTSIGNAL AI</text>',
    '<text x="0" y="46" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="13" letter-spacing="2" text-anchor="end">' + escapeXml(typeLbl.toUpperCase()) + '</text>',
    '</g>',

    // Big price + 24h change
    '<text x="64" y="200" fill="' + BRAND.text + '" font-family="Inter, Segoe UI, sans-serif" font-size="56" font-weight="800">$' + escapeXml(priceText) + '</text>',
    '<text x="64" y="232" fill="' + pctColor + '" font-family="Inter, Segoe UI, sans-serif" font-size="22" font-weight="700">' + escapeXml(pctArrow + " " + pctText) + '</text>',
    '<text x="' + (64 + 16 + (pctText.length + 2) * 13) + '" y="232" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="14">24ч изменение</text>',

    // Headline
    '<text x="64" y="282" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="20" font-weight="700">' + escapeXml(headline) + '</text>',

    // Middle row: levels strip OR multi-coin snapshot strip
    levelsBlock,
    stripBlock,

    // Bottom row: bias / confidence / risk
    block(0, "Bias", bias, "направление", biasColor),
    block(1, "Уверенность", conf, "качество сигнала", BRAND.accentSoft),
    block(2, "Риск", risk, "управляйте размером", riskColor),

    // Footer disclaimer + bot
    '<text x="64" y="' + (H - 18) + '" fill="' + BRAND.muted + '" font-family="Inter, Segoe UI, sans-serif" font-size="12">Не финансовая рекомендация. Управляйте риском.</text>',
    '<text x="' + (W - 64) + '" y="' + (H - 18) + '" fill="' + BRAND.accentSoft + '" font-family="Inter, Segoe UI, sans-serif" font-size="12" font-weight="700" letter-spacing="1" text-anchor="end">t.me/QUANTSIGNAL_AI_BOT</text>',

    '</svg>'
  ].join("");
}

function renderForPlan(plan) {
  // Enrich plan with levels if applicable so the SVG knows what to draw.
  let p = plan;
  if (plan && plan.type === "signal_idea" && plan.hero && plan.hero.last != null && !plan.levels) {
    const engine = require("./content-engine");
    p = Object.assign({}, plan, { levels: engine.levelsFor(plan.hero) });
  }
  const svg = buildSvg(p);
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return {
    svg: svg,
    svg_base64: base64,
    content_type: "image/svg+xml",
    data_url: "data:image/svg+xml;base64," + base64
  };
}

module.exports = {
  renderForPlan: renderForPlan,
  buildSvg: buildSvg,
  escapeXml: escapeXml,
  BRAND: BRAND
};
