#!/usr/bin/env node
/* Verify mobile-tap stability for currency rows / chips / cells.
   Live realtime updates were re-rendering #matrix and #coin-chips by
   replacing innerHTML, which detached tappable nodes mid-tap (Playwright
   "DOGE chip" flake). This script asserts that:
     - app.js parses
     - the three live render sites use diff-update (insertBefore + reused
       nodes), NOT a blanket el.innerHTML = ... of fresh markup
     - click handling is delegated to document (so handlers survive
       re-renders) AND targets containers via .closest([data-symbol])
     - top nav (section nav) stays removed
     - bottom navigation (.tabbar with data-nav tabs) is present
     - coin logo system (coinLogoSVG + COIN_LOGO_PATHS) is wired

   Exits non-zero on any failure. Mirrors verify-banners / verify-splash. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function read(p) { return readFileSync(resolve(root, p), "utf8"); }
function ok(label) { console.log(`[OK] ${label}`); }
function fail(label, info) {
  console.error(`[FAIL] ${label}` + (info ? ` :: ${info}` : ""));
  process.exit(1);
}
function must(label, predicate, info) {
  if (!predicate) fail(label, info); else ok(label);
}

const app = read("app.js");
const html = read("index.html");

// --- app.js parses ---------------------------------------------------------
try { new Function(app); ok("app.js parses"); }
catch (e) { fail("app.js parse error", e.message); }

// --- Top section nav must stay removed -------------------------------------
must("topnav class absent in HTML",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html),
  "the top section nav must remain removed");
must("setScreen does not touch .topnav__tab",
  !/\.topnav__tab/.test(app),
  "no topnav__tab references should remain in app.js");

// --- Bottom navigation must remain ----------------------------------------
must("bottom .tabbar present",
  /<nav[^>]*class="tabbar"/.test(html),
  "bottom .tabbar nav must exist");
const tabMatches = html.match(/class="tab"[^>]*data-nav="([a-z]+)"/g) || [];
must("bottom tabs cover ≥4 screens",
  tabMatches.length >= 4,
  `expected ≥4 bottom tabs, found ${tabMatches.length}`);

// --- Coin logo system wired ------------------------------------------------
must("coinLogoSVG helper present",
  /function\s+coinLogoSVG\s*\(/.test(app),
  "coinLogoSVG() helper missing");
must("COIN_LOGO_PATHS map present",
  /COIN_LOGO_PATHS/.test(app),
  "COIN_LOGO_PATHS missing");
const logoSiteCount = (app.match(/coinLogoSVG\(/g) || []).length;
must("coinLogoSVG used at ≥5 render sites",
  logoSiteCount >= 5,
  `coinLogoSVG referenced ${logoSiteCount} times — expected ≥5`);

// --- Click handlers are delegated to document ------------------------------
must("click handling is delegated on document",
  /document\.addEventListener\(\s*["']click["']/.test(app),
  "expected a single delegated document click listener");
for (const sel of [
  '.matrix-cell[data-symbol]',
  '.coin-chip[data-symbol]'
]) {
  must(`closest("${sel}") used in click delegation`,
    app.includes(`closest("${sel}")`) || app.includes(`closest('${sel}')`),
    `expected event delegation to target ${sel}`);
}

// --- The three live render sites must NOT blanket-rewrite innerHTML --------
//
// We extract each function body and look for two things:
//   1. it does not reassign `el.innerHTML = ...` with templated cell markup
//      (loading skeleton placeholders are allowed and explicit);
//   2. it uses insertBefore() for diff reuse.
//
function extractFn(src, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(m.index, i);
}

for (const fn of ["renderMarketScreen", "renderCoinChips"]) {
  const body = extractFn(app, fn);
  must(`${fn} found`, !!body, `could not extract ${fn} body`);
  // Forbid innerHTML assignments that emit the actual row/cell/chip markup
  // for the steady-state path. We deliberately allow skeleton placeholders.
  const innerHtmlAssigns = (body.match(/\.innerHTML\s*=\s*[^;]+/g) || []);
  for (const expr of innerHtmlAssigns) {
    const allowed =
      /skeleton/.test(expr) ||                 // loading state
      /innerHTML\s*=\s*['"`]\s*['"`]/.test(expr); // clear-to-empty
    must(`${fn}: innerHTML assignment is restricted to skeleton/clear`,
      allowed,
      `forbidden innerHTML reassign in ${fn}: ${expr.trim().slice(0, 80)}`);
  }
  must(`${fn} uses insertBefore for diff reuse`,
    /\binsertBefore\s*\(/.test(body),
    `${fn} should reuse nodes via insertBefore`);
  must(`${fn} indexes existing nodes by data-symbol`,
    /getAttribute\(\s*["']data-symbol["']\s*\)/.test(body),
    `${fn} should look up existing nodes by [data-symbol]`);
}

// --- Realtime update path still triggers the diff renders ------------------
must("onRealtimeTickers re-renders market matrix",
  /onRealtimeTickers[\s\S]{0,400}renderMarketScreen\(\)/.test(app),
  "live tickers must keep updating the market matrix");

console.log("verify-tap-stability OK");
