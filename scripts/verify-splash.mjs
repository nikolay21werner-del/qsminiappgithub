#!/usr/bin/env node
/* Smoke test: static check that the splash/welcome screen, Q-mark identity,
   and reference-style dashboard elements (last-signal card, AI radar, top nav)
   are present in index.html / styles.css / assets / i18n. No browser is
   started — this is a content / wiring check intended for CI.

   Exits non-zero on any failure. */

import { readFileSync, existsSync } from "node:fs";
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

// --- Splash markup --------------------------------------------------------
must("splash root present",
  /id="boot-splash"[^>]*data-testid="boot-splash"/.test(html),
  "missing #boot-splash root with data-testid");
// The animated Q-mark glyph was removed in favour of the user-provided
// QUANTSIGNAL AI label JPEG, which is now the canonical splash brand.
must("splash brand label img",
  /<img[\s\S]*?class="boot-splash__label"[\s\S]*?src="\.\/assets\/telegram\/quantsignal-label\.jpeg"/.test(html),
  "expected the QUANTSIGNAL AI label JPEG as the splash brand image");
must("old qmark.svg no longer used as splash primary",
  !/<img\s+src="\.\/assets\/qmark\.svg"/.test(html),
  "splash should not show the old qmark.svg above the label");
must("splash title element (kept for a11y/i18n)",
  /class="boot-splash__title[^"]*"[^>]*>QUANTSIGNAL\s+<span class="boot-splash__ai">AI<\/span>/.test(html),
  "splash title block missing");
must("splash status data-i18n", /id="boot-status"[^>]*data-i18n="bootStep1"/.test(html),
  "boot-status must default to bootStep1 i18n key");
must("splash progress bar", /id="boot-progress-bar"/.test(html),
  "missing #boot-progress-bar");
must("splash features grid", /class="boot-splash__features"/.test(html));
must("splash hint i18n", /data-i18n="bootHint"/.test(html));

// --- Topbar brand icon ---------------------------------------------------
// In the Mini App topbar the full QUANTSIGNAL AI label is replaced by a
// compact square brand icon (Q + trend-arrow) so the header stays clean
// on mobile. The full label remains canonical on the boot splash, the bot
// welcome banner, the channel banner, and the shared brand assets.
must("topbar brand compact icon (no-text mark cropped from label)",
  /class="topbar__icon"[\s\S]*?assets\/brand\/qsi-mark\.png/.test(html),
  "topbar must include the compact .topbar__icon brand icon (qsi-mark.png)");
must("topbar no longer renders the full QUANTSIGNAL AI label",
  !/class="topbar__label"/.test(html) &&
  !/data-testid="topbar-label"/.test(html),
  "topbar must not include the full-width .topbar__label image");
must("old topbar qmark removed",
  !/class="topbar__qmark"/.test(html),
  "topbar must not include the old .topbar__qmark glyph");
must("topbar does not fall back to the legacy qmark.svg",
  !/class="topbar__icon"[\s\S]{0,200}assets\/qmark\.svg/.test(html),
  "topbar icon must be the no-text qsi-mark.png, not the old qmark.svg");
must("topbar does not use the stylized qsi-icon.svg approximation",
  !/class="topbar__icon"[\s\S]{0,200}assets\/brand\/qsi-icon\.svg/.test(html),
  "topbar icon must be the cropped no-text mark (qsi-mark.png), not the stylized qsi-icon.svg");
must("topbar does not use the full label JPEG (the full label belongs on splash/banners)",
  !/class="topbar__icon"[\s\S]{0,200}quantsignal-label\.(jpe?g|png)/.test(html),
  "topbar icon must be the cropped no-text mark, not the full label artwork");
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
// The Crypto Combat tap-game has been fully removed. The bottom nav must
// still carry only the canonical 5 tabs (overview/signals/market/ai/profile),
// and no game CTA or arena hooks should remain anywhere in the document.
const tabbarBlock = (html.match(/<nav[^>]*class="tabbar"[\s\S]*?<\/nav>/) || [""])[0];
must("no combat/tap/game entry in bottom nav",
  !/data-nav="combat"/.test(tabbarBlock) &&
  !/data-nav="tap"/.test(tabbarBlock) &&
  !/data-nav="game"/.test(tabbarBlock),
  "no game tab must exist in the bottom nav");
must("no Crypto Combat hooks anywhere in index.html",
  !/combat-/.test(html) &&
  !/open-combat|close-combat|combat-claim|combat-buy/.test(html) &&
  !/id="combat-cta-card"|id="combat-sheet"/.test(html),
  "the Crypto Combat game must be fully removed from index.html");

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

// --- Brand label asset sanity --------------------------------------------
// The canonical brand asset is the user-provided QUANTSIGNAL AI label JPEG
// (splash + bot welcome + channel banner). The compact .topbar__icon used
// in the Mini App header is a separate square SVG cropped from the same
// brand system: the Q + trend-arrow mark cropped directly from the canonical
// QUANTSIGNAL AI label JPEG with all text (QUANTSIGNAL, AI, RU subtitle)
// removed. The old qmark.svg and the earlier stylized qsi-icon.svg may still
// exist on disk for reference but are no longer visible brand elements.
must("brand label JPEG asset present",
  existsSync(resolve(root, "assets/telegram/quantsignal-label.jpeg")),
  "assets/telegram/quantsignal-label.jpeg must exist");
must("compact topbar icon asset present (no-text mark cropped from label)",
  existsSync(resolve(root, "assets/brand/qsi-mark.png")),
  "assets/brand/qsi-mark.png must exist for the Mini App topbar");

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
