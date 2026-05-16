#!/usr/bin/env node
/* Smoke test for the per-coin banner mappings and the broader currency universe.
   Verifies that:
     - app.js parses
     - every "major" coin has both a JS COIN_BRANDS entry AND a CSS palette
     - the curated symbol universe in api.js is large enough and well-formed
     - the hero banner DOM hooks exist
   Exits non-zero on any failure. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const apiJs = fs.readFileSync(path.join(root, "api.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// Major coins that MUST have both a brand entry and CSS palette.
const MAJOR_COINS = [
  "BTC", "ETH", "SOL", "TON", "BNB", "XRP",
  "DOGE", "ADA", "AVAX", "LINK", "DOT", "POL",
  "LTC", "TRX", "NEAR", "ARB", "OP", "SUI",
  "APT", "1000PEPE", "1000SHIB", "BCH", "UNI",
  "ATOM", "ETC", "DEFAULT"
];

const errors = [];

try { new Function(js); } catch (e) { errors.push("app.js parse error: " + e.message); }
try { new Function(apiJs); } catch (e) { errors.push("api.js parse error: " + e.message); }

for (const k of MAJOR_COINS) {
  if (!css.includes(`[data-coin="${k}"]`)) errors.push(`CSS palette missing for ${k}`);
}
for (const k of MAJOR_COINS.filter(c => c !== "DEFAULT")) {
  // COIN_BRANDS keys can be plain (BTC:) or quoted ("1000PEPE":); accept both.
  const plain = new RegExp(`(^|\\s)${k}:\\s*\\{[^}]*glyph`, "m");
  const quoted = new RegExp(`"${k}":\\s*\\{[^}]*glyph`);
  if (!plain.test(js) && !quoted.test(js)) {
    errors.push(`COIN_BRANDS entry missing for ${k}`);
  }
}

for (const id of ["hero-banner", "hero-banner-glyph", "hero-banner-tag", "hero-coin-mark"]) {
  if (!html.includes(`id="${id}"`)) errors.push(`HTML hook missing: ${id}`);
}
for (const id of ["market-search", "coin-chips", "market-empty", "market-count"]) {
  if (!html.includes(`id="${id}"`)) errors.push(`HTML hook missing: ${id}`);
}

if (!js.includes("applyCoinBranding")) errors.push("applyCoinBranding helper missing in app.js");
if (!js.includes("renderCoinChips")) errors.push("renderCoinChips helper missing in app.js");
if (!js.includes("selectSymbol")) errors.push("selectSymbol helper missing in app.js");
if (!js.includes("filterTickers")) errors.push("filterTickers helper missing in app.js");

// Curated universe sanity — at least 25 symbols, all uppercase, USDT-suffixed.
const m = apiJs.match(/var\s+CURATED_SYMBOLS\s*=\s*\[([\s\S]*?)\];/);
if (!m) {
  errors.push("CURATED_SYMBOLS array missing in api.js");
} else {
  const list = (m[1].match(/"[^"]+"/g) || []).map(s => s.slice(1, -1));
  if (list.length < 25) errors.push(`CURATED_SYMBOLS too small: ${list.length}`);
  for (const s of list) {
    if (!/^[A-Z0-9]+USDT$/.test(s)) errors.push(`Bad symbol in CURATED_SYMBOLS: ${s}`);
  }
  if (!list.includes("BTCUSDT")) errors.push("BTCUSDT missing from CURATED_SYMBOLS");
  if (!list.includes("ETHUSDT")) errors.push("ETHUSDT missing from CURATED_SYMBOLS");
}

if (!apiJs.includes("bybitGetInstruments")) {
  errors.push("bybitGetInstruments helper missing in api.js");
}

// --- Inline SVG coin-logo system -----------------------------------------
// Each major coin must have an entry in COIN_LOGO_PATHS, and a SYM:- or
// "SYM": form is accepted (1000PEPE/1000SHIB use the quoted form via
// dynamic assignment, so we also look for SYM aliasing lines).
if (!js.includes("COIN_LOGO_PATHS")) {
  errors.push("COIN_LOGO_PATHS map missing in app.js");
}
if (!/function\s+coinLogoSVG\s*\(/.test(js)) {
  errors.push("coinLogoSVG() helper missing in app.js");
}
if (!/function\s+coinMonogram\s*\(/.test(js)) {
  errors.push("coinMonogram() fallback helper missing in app.js");
}
for (const k of MAJOR_COINS.filter(c => c !== "DEFAULT")) {
  const plain = new RegExp(`(?:^|[\\s,{])${k}:\\s*'`, "m");
  const quoted = new RegExp(`"${k}":\\s*'`);
  const aliased = new RegExp(
    `COIN_LOGO_PATHS\\[?["']?${k}["']?\\]?\\s*=`
  );
  if (!plain.test(js) && !quoted.test(js) && !aliased.test(js)) {
    errors.push(`COIN_LOGO_PATHS entry missing for ${k}`);
  }
}
// Coin marks should be rendered via coinLogoSVG (not the plain text mark)
// in the render sites we control.
for (const site of [
  "renderOverviewRows",
  "renderSignalsScreen",
  "renderCoinChips",
  "renderLastSignal",
  "applyCoinBranding"
]) {
  // crude check: site exists
  if (!js.includes(site)) errors.push(`render site missing: ${site}`);
}
const sitesUsingLogo = (js.match(/coinLogoSVG\(/g) || []).length;
if (sitesUsingLogo < 5) {
  errors.push(`coinLogoSVG is used ${sitesUsingLogo}× — expected ≥5 (hero, last-signal, rows, signals, chips)`);
}

// CSS: SVG logos inside .coin-mark must be sized.
if (!/coin-mark\s*>\s*svg\.coin-logo|svg\.coin-logo/.test(css)) {
  errors.push("styles.css must size .coin-logo inside .coin-mark/.row-coin/.coin-chip__mark");
}

if (errors.length) {
  console.error("verify-banners FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
const branded = MAJOR_COINS.length - 1;
console.log(
  `verify-banners OK (${MAJOR_COINS.length} palettes, ${branded} branded coins, curated set verified).`
);
