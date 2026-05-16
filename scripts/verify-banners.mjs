#!/usr/bin/env node
/* Smoke test for the per-coin banner mappings.
   Verifies that for every supported symbol we ship:
     - a CSS palette  ([data-coin="<KEY>"] ...)
     - a JS COIN_BRANDS entry
     - the HTML hooks the hero banner needs
   Exits non-zero if anything is missing or the JS has a syntax error. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const COINS = ["BTC", "ETH", "SOL", "TON", "BNB", "XRP", "DEFAULT"];
const errors = [];

try { new Function(js); } catch (e) { errors.push("app.js parse error: " + e.message); }

for (const k of COINS) {
  if (!css.includes(`[data-coin="${k}"]`)) errors.push(`CSS palette missing for ${k}`);
}
for (const k of COINS.filter(c => c !== "DEFAULT")) {
  const re = new RegExp(`\\b${k}:\\s*\\{[^}]*glyph`);
  if (!re.test(js)) errors.push(`COIN_BRANDS entry missing for ${k}`);
}
for (const id of ["hero-banner", "hero-banner-glyph", "hero-banner-tag", "hero-coin-mark"]) {
  if (!html.includes(`id="${id}"`)) errors.push(`HTML hook missing: ${id}`);
}
if (!js.includes("applyCoinBranding")) errors.push("applyCoinBranding helper missing in app.js");

if (errors.length) {
  console.error("verify-banners FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`verify-banners OK (${COINS.length} palettes, ${COINS.length - 1} branded coins).`);
