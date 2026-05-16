#!/usr/bin/env node
/* Smoke test: static check that the splash/welcome screen, Q-mark identity,
   and reference-style dashboard elements (last-signal card, AI radar, top nav)
   are present in index.html / styles.css / assets / i18n. No browser is
   started — this is a content / wiring check intended for CI.

   Exits non-zero on any failure. */

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

const html = read("index.html");
const css = read("styles.css");
const i18n = read("i18n.js");
const qmark = read("assets/qmark.svg");

// --- Splash markup --------------------------------------------------------
must("splash root present",
  /id="boot-splash"[^>]*data-testid="boot-splash"/.test(html),
  "missing #boot-splash root with data-testid");
must("splash Q-mark img", /<img\s+src="\.\/assets\/qmark\.svg"/.test(html),
  "expected <img src=./assets/qmark.svg> inside splash");
must("splash title element",
  /class="boot-splash__title"[^>]*>QUANTSIGNAL\s+<span class="boot-splash__ai">AI<\/span>/.test(html),
  "splash title block missing");
must("splash status data-i18n", /id="boot-status"[^>]*data-i18n="bootStep1"/.test(html),
  "boot-status must default to bootStep1 i18n key");
must("splash progress bar", /id="boot-progress-bar"/.test(html),
  "missing #boot-progress-bar");
must("splash features grid", /class="boot-splash__features"/.test(html));
must("splash hint i18n", /data-i18n="bootHint"/.test(html));

// --- Topbar Q-mark / mini app label --------------------------------------
must("topbar Q-mark", /class="topbar__qmark"[\s\S]*?qmark\.svg/.test(html),
  "topbar must include Q-mark identity");
must("mini app subtitle i18n", /data-i18n="miniAppSub"/.test(html));

// --- Top section nav removed by user request -----------------------------
// Bottom .tabbar is now the only nav surface; assert the top panel is gone.
must("topnav removed from HTML",
  !/class="topnav"/.test(html) && !/data-testid="topnav"/.test(html),
  "top nav (Дашборд/Сигналы/Рынок/Портфель/Профиль) must be removed");
must("topnav__tab class absent in HTML",
  !/topnav__tab/.test(html),
  "no topnav__tab buttons should remain");
must("bottom tabbar still wired",
  /<nav\s+class="tabbar"/.test(html) && /class="tab[^"]*"[^>]*data-nav="overview"/.test(html),
  "bottom .tabbar must remain as the sole nav");

// --- Last-signal card ----------------------------------------------------
must("last-signal card", /id="last-signal-card"[^>]*data-testid="last-signal-card"/.test(html));
must("strong-signal CTA", /data-testid="strong-signal-cta"/.test(html));
must("last-signal entry/tp1/tp2/stop",
  /id="last-signal-entry"/.test(html)
  && /id="last-signal-tp1"/.test(html)
  && /id="last-signal-tp2"/.test(html)
  && /id="last-signal-stop"/.test(html));

// --- AI radar -------------------------------------------------------------
must("AI summary radar variant", /class="card ai-summary ai-summary--radar"[\s\S]*?data-testid="ai-summary-card"/.test(html));
must("AI radar core text", /class="ai-radar__core">AI<\/span>/.test(html));

// --- Q-mark SVG sanity ----------------------------------------------------
must("qmark.svg has teal+orange tones",
  /#26e6f2|#5ef9ff/.test(qmark) && /#ff8a2b|#ffb547|#f7a330/.test(qmark),
  "qmark.svg must include teal Q + orange arrow palette");

// --- i18n keys for all three languages -----------------------------------
const requiredKeys = [
  "bootTagline", "bootHint",
  "bootStep1", "bootStep2", "bootStep3", "bootStep4",
  "bootFeatSignals", "bootFeatMarket", "bootFeatAI", "bootFeatRisk",
  "miniAppSub", "navDashboard", "navPortfolio",
  "lastSignalTitle", "strongSignal", "sideLong", "sideShort", "aiMood"
];
for (const key of requiredKeys) {
  // Each i18n dict block has a `key:` line; require at least 3 occurrences (en/ru/zh).
  const re = new RegExp("\\b" + key + ":\\s*\"");
  const count = (i18n.match(new RegExp("\\b" + key + ":\\s*\"", "g")) || []).length;
  if (count < 3) fail(`i18n key '${key}' missing for all three locales`, `found ${count}/3`);
}
ok(`i18n keys present for ru/en/zh (${requiredKeys.length} keys)`);

// --- CSS hooks ------------------------------------------------------------
must("CSS has .boot-splash", /\.boot-splash\b/.test(css));
must("CSS has body.boot-done hide", /body\.boot-done\s+\.boot-splash/.test(css));
must("CSS has no leftover .topnav rules",
  !/\.topnav(?:__tab)?\s*\{/.test(css),
  ".topnav CSS rules must be removed");
must("CSS has .last-signal", /\.last-signal\b/.test(css));
must("CSS has .ai-radar", /\.ai-radar\b/.test(css));
must("CSS respects prefers-reduced-motion for splash",
  /@media\s+\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.boot-splash__/.test(css));

// --- App wiring -----------------------------------------------------------
const app = read("app.js");
must("app.js wires splash boot", /var\s+splash\s*=\s*\(function/.test(app));
must("app.js hides splash on data ready",
  /splash\.dataReady\(\)/.test(app),
  "expected splash.dataReady() to be called once tickers arrive");
must("app.js hides splash on hard cap",
  /setTimeout\(hide,\s*MAX_MS/.test(app),
  "expected hard MAX_MS timeout in splash module");
must("app.js renders last-signal", /function\s+renderLastSignal\s*\(/.test(app));
must("setScreen no longer references .topnav__tab",
  !/\.topnav__tab/.test(app),
  "setScreen must not reference the removed top nav");
must("app.js wires inline SVG coin logos",
  /function\s+coinLogoSVG\s*\(/.test(app) && /COIN_LOGO_PATHS/.test(app),
  "expected coinLogoSVG()/COIN_LOGO_PATHS in app.js");

console.log(`\nAll splash/redesign smoke checks passed.`);
