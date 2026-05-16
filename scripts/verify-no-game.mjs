#!/usr/bin/env node
/* verify-no-game.mjs
 *
 * The Crypto Combat / tap-game was removed from QUANTSIGNAL AI. This script
 * locks that removal in place: every check is an *absence* assertion, so
 * future commits cannot quietly resurrect the game without tripping CI.
 *
 * It also re-asserts that the non-game shell (top nav removed, bottom nav
 * intact, market/AI wired, AI/Bybit serverless endpoints still present) is
 * still in shape after the cleanup.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let failed = 0;
function must(label, cond, hint) {
  if (cond) { console.log("  ok   " + label); return; }
  failed++;
  console.error("  FAIL " + label + (hint ? "  — " + hint : ""));
}
function read(p) { return readFileSync(join(root, p), "utf8"); }

const html      = read("index.html");
const app       = read("app.js");
const css       = read("styles.css");
const i18n      = read("i18n.js");
const vercel    = JSON.parse(read("vercel.json"));
const pkg       = JSON.parse(read("package.json"));

// ---- 1. Index/UI: no game markup, no game hooks ------------------------
must("no Crypto Combat CTA card",
  !/id="combat-cta-card"/.test(html) && !/class="combat-cta/.test(html));
must("no Crypto Combat sheet",
  !/id="combat-sheet"/.test(html) && !/sheet--combat/.test(html));
must("no QP/Level chips",
  !/id="combat-cta-balance"/.test(html) && !/id="combat-cta-level"/.test(html));
must("no open/close-combat actions in HTML",
  !/data-action="(open|close)-combat"/.test(html));
must("no Stars boost buy buttons in HTML",
  !/data-action="combat-buy"/.test(html) && !/data-action="combat-claim"/.test(html));
must("no combat-* class names in HTML",
  !/class="[^"]*\bcombat-/.test(html));
must("no leftover game data-testids",
  !/data-testid="combat-/.test(html));

// ---- 2. app.js: no combat module, no game endpoints --------------------
must("no `var combat = (function` IIFE in app.js",
  !/var\s+combat\s*=\s*\(function/.test(app));
must("no QSI_COMBAT global export",
  !/QSI_COMBAT/.test(app));
must("no /api/combat or /api/stars references in app.js",
  !/\/api\/(combat|stars)\b/.test(app));
must("no CloudStorage game key in app.js",
  !/qsi_combat_v1/.test(app));
must("no open-combat / combat-buy switch cases",
  !/case\s+"(open|close)-combat"/.test(app) && !/case\s+"combat-(buy|claim|reset)"/.test(app));

// ---- 3. styles.css: no combat selectors / keyframes --------------------
must("no .combat-* selectors in CSS",
  !/\.combat-/.test(css));
must("no sheet--combat / cta--combat in CSS",
  !/sheet--combat|cta--combat/.test(css));
must("no @keyframes combat* in CSS",
  !/@keyframes\s+combat/i.test(css));

// ---- 4. i18n.js: no combat string keys ---------------------------------
must("no combat* string keys in i18n.js",
  !/\bcombat[A-Z]/.test(i18n));

// ---- 5. vercel.json: no game endpoints ---------------------------------
const fns = Object.keys(vercel.functions || {});
must("no api/combat/* function in vercel.json",
  !fns.some(f => f.startsWith("api/combat/")));
must("no api/stars/* function in vercel.json",
  !fns.some(f => f.startsWith("api/stars/")));
must("no api/telegram/webhook function in vercel.json",
  !fns.some(f => f.startsWith("api/telegram/")));

// ---- 6. Filesystem: removed endpoint files / verify scripts ------------
const removedPaths = [
  "api/combat",
  "api/stars",
  "api/telegram",
  "api/_lib/combat-logic.js",
  "api/_lib/telegram-auth.js",
  "scripts/verify-game.mjs",
  "scripts/verify-real-tapper.mjs",
  "scripts/verify-design.mjs",
];
for (const p of removedPaths) {
  must("removed " + p, !existsSync(join(root, p)));
}

// ---- 7. package.json: removed verify scripts ---------------------------
const scripts = pkg.scripts || {};
must("no verify:game script", !("verify:game" in scripts));
must("no verify:real-tapper script", !("verify:real-tapper" in scripts));
must("no verify:design script", !("verify:design" in scripts));

// ---- 8. Top nav still removed, bottom nav still intact -----------------
must("top nav remains absent",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
must("bottom tabbar still has overview/signals/market/ai/profile",
  /<nav\s+class="tabbar"/.test(html)
  && /data-nav="overview"/.test(html)
  && /data-nav="signals"/.test(html)
  && /data-nav="market"/.test(html)
  && /data-nav="ai"/.test(html)
  && /data-nav="profile"/.test(html));

// ---- 9. Non-game APIs and wiring preserved -----------------------------
must("ai/chat endpoint still listed in vercel.json",
  "api/ai/chat.js" in (vercel.functions || {}));
must("bybit endpoint still listed in vercel.json",
  "api/bybit/[endpoint].js" in (vercel.functions || {}));
must("app.js wires Bybit / market REST",
  /\/api\/bybit\//.test(app) || /bybit/.test(app));
must("app.js wires the AI chat endpoint",
  /\/api\/ai\/chat/.test(app) || /QSI_AI|aiChat|ai-chat/.test(app));

// ---- 10. JS parse check across remaining endpoint files ---------------
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const apiFiles = existsSync(join(root, "api")) ? walk(join(root, "api")) : [];
must("api/ tree contains no combat/stars/telegram files",
  apiFiles.every(p => !/\/(combat|stars|telegram)\//.test(p)
                   && !/combat-logic|telegram-auth/.test(p)));
for (const p of [join(root, "app.js"), join(root, "i18n.js"), join(root, "api.js"), ...apiFiles]) {
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
    console.log("  ok   parses " + p.replace(root + "/", ""));
  } catch (e) {
    failed++;
    console.error("  FAIL parses " + p + "  — " + (e.stderr ? e.stderr.toString().trim() : e.message));
  }
}

if (failed) {
  console.error("\nverify-no-game: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-no-game OK");
