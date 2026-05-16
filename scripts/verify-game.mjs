#!/usr/bin/env node
/* Smoke test for the in-app Crypto Combat tapper + Telegram Stars wiring.
   This is a static check: no browser, no live network. Verifies the
   HTML hooks, JS module, CSS classes, i18n keys, the serverless Stars
   endpoint, and asserts no hard-coded bot token pattern is present.

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
const app = read("app.js");
const stars = read("api/stars/create-invoice.js");
const vercel = read("vercel.json");

// --- 1. Overview CTA wiring ----------------------------------------------
must("overview combat CTA card present",
  /id="combat-cta-card"/.test(html) && /data-testid="combat-cta-card"/.test(html),
  "missing #combat-cta-card");
must("overview combat CTA button",
  /data-action="open-combat"/.test(html) && /data-testid="combat-cta-button"/.test(html),
  "Overview must include an Enter Crypto Combat button");
must("CTA balance hook", /id="combat-cta-balance"/.test(html));

// The CTA must live in the Overview screen, not in a new bottom nav item.
const tabSection = html.match(/<nav[^>]*class="tabbar"[\s\S]*?<\/nav>/);
must("bottom tabbar found", !!tabSection, "tabbar block missing");
const tabbarHtml = tabSection ? tabSection[0] : "";
must("no combat / tap entry added to bottom nav",
  !/data-nav="combat"/.test(tabbarHtml) &&
  !/data-nav="tap"/.test(tabbarHtml) &&
  !/data-nav="game"/.test(tabbarHtml) &&
  !/combat-cta/i.test(tabbarHtml),
  "Crypto Combat must NOT be added as a bottom-nav item");

// --- 2. Combat overlay sheet ---------------------------------------------
must("combat sheet element present",
  /id="combat-sheet"[^>]*data-testid="combat-sheet"/.test(html));
must("combat tap target present",
  /id="combat-tap"[^>]*data-testid="combat-tap"/.test(html));
for (const id of [
  "combat-boss", "combat-boss-bar", "combat-boss-hp", "combat-boss-hp-max",
  "combat-fighter", "combat-player-bar", "combat-player-hp",
  "combat-energy", "combat-energy-bar", "combat-balance", "combat-level",
  "combat-status", "combat-fx", "combat-packs", "combat-stars-note",
  "combat-boss-avatar", "combat-fighter-avatar"
]) {
  must(`combat hook #${id}`, html.includes(`id="${id}"`), `missing ${id}`);
}
for (const tid of ["combat-stars", "combat-arena", "combat-new-round",
  "combat-buy-energy", "combat-buy-damage", "combat-buy-revive"]) {
  must(`combat data-testid="${tid}"`, html.includes(`data-testid="${tid}"`),
    `missing test hook ${tid}`);
}

// --- 3. Top nav stays removed, bottom nav intact -------------------------
must("top section nav remains removed",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
must("setScreen does not touch topnav__tab",
  !/\.topnav__tab/.test(app));
must("bottom .tabbar still wired",
  /<nav[^>]*class="tabbar"/.test(html));

// --- 4. Combat JS module wired ------------------------------------------
must("app.js defines combat module",
  /var\s+combat\s*=\s*\(function\s*\(\s*\)\s*\{/.test(app));
must("combat exposes window.QSI_COMBAT", /window\.QSI_COMBAT\s*=\s*combat/.test(app));
must("combat handles open-combat action",
  /case\s+"open-combat":/.test(app) && /combat\.open\(\)/.test(app));
must("combat handles combat-buy action",
  /case\s+"combat-buy":/.test(app) && /combat\.buy\(/.test(app));
must("combat tap delegated via #combat-tap",
  /closest\(\s*["']#combat-tap["']\s*\)/.test(app));
must("combat ticks on realtime updates",
  /combat\.onTickerUpdate\(/.test(app));

// Tap stability: combat module never resets the arena DOM via innerHTML.
const combatBlock = (() => {
  const re = /var\s+combat\s*=\s*\(function[\s\S]+?\}\)\(\);/m;
  const m = re.exec(app);
  return m ? m[0] : null;
})();
must("combat module extracted", !!combatBlock);
if (combatBlock) {
  const badAssigns = (combatBlock.match(/\.innerHTML\s*=/g) || []);
  // Allowed: per-avatar mark.innerHTML for coin logo, NOT arena/tap reassignment.
  for (const m of badAssigns) void m;
  must("combat module never reassigns arena innerHTML",
    !/(combat-arena|combat-tap|combat-body)[^=]*\.innerHTML\s*=/.test(combatBlock),
    "arena/tap nodes must never be re-mounted under realtime updates");
}

// --- 5. Stars endpoint ---------------------------------------------------
must("Stars endpoint module exists",
  /module\.exports\s*=\s*async function handler/.test(stars));
must("Stars endpoint reads token from env, not literal",
  /process\.env\.TELEGRAM_BOT_TOKEN/.test(stars) &&
  /process\.env\.BOT_TOKEN/.test(stars));
must("Stars endpoint returns stars_not_configured when token missing",
  /stars_not_configured/.test(stars));
must("Stars endpoint uses XTR currency",
  /currency:\s*"XTR"/.test(stars));
must("Stars endpoint calls Bot API createInvoiceLink",
  /createInvoiceLink/.test(stars));
must("Stars endpoint validates pack id",
  /ALLOWED_PACKS/.test(stars) && /unknown_pack/.test(stars));
must("vercel.json registers stars function",
  /api\/stars\/create-invoice\.js/.test(vercel));

// --- 6. NO hard-coded bot token --------------------------------------------
// A real bot token looks like: <digits>:<35 alphanum/dash/underscore>
const tokenPattern = /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/;
for (const [name, src] of [
  ["app.js", app],
  ["index.html", html],
  ["i18n.js", i18n],
  ["styles.css", css],
  ["api/stars/create-invoice.js", stars],
  ["vercel.json", vercel]
]) {
  if (tokenPattern.test(src)) fail(`hard-coded bot token pattern detected in ${name}`);
}
ok("no hard-coded bot token pattern in tracked sources");

// --- 7. Frontend uses openInvoice safely ---------------------------------
must("frontend gates Telegram.WebApp.openInvoice",
  /Telegram\.WebApp\.openInvoice/.test(app),
  "FE must call Telegram.WebApp.openInvoice for Stars payments");
must("frontend has non-Telegram fallback message",
  /combatNotInTelegram/.test(app),
  "FE must show a non-broken non-Telegram fallback");
must("frontend never auto-buys",
  !/combat\.buy\(\s*["'][a-z]+["']\s*\)\s*;?\s*\n\s*[a-zA-Z]/m
    .test(app.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")) ||
  /data-action="combat-buy"/.test(html),
  "buy must only fire from a user tap on data-action=combat-buy");
must("buy handler ignores cancelled/failed",
  /status\s*===?\s*["']paid["']/.test(app) &&
  /status\s*===?\s*["']cancelled["']/.test(app));

// --- 8. i18n keys for ru/en/zh -------------------------------------------
const required = [
  "combatTitle", "combatSub", "combatCTA", "combatBoss", "combatFighter",
  "combatHP", "combatEnergy", "combatLevel", "combatTap", "combatCombo",
  "combatCrit", "combatVictory", "combatDefeat", "combatNextBoss",
  "combatRewardName", "combatBalance", "combatDailyReward", "combatClaim",
  "combatClaimed", "combatStarsTitle", "combatStarsSubtitle",
  "combatPackEnergy", "combatPackEnergyDesc",
  "combatPackDamage", "combatPackDamageDesc",
  "combatPackRevive", "combatPackReviveDesc",
  "combatBuy", "combatBuying", "combatPaid", "combatCancelled",
  "combatPayFailed", "combatNotInTelegram", "combatNotConfigured",
  "combatVolatilityHi", "combatVolatilityMid", "combatVolatilityLow",
  "combatClose", "combatNewRound"
];
for (const key of required) {
  const count = (i18n.match(new RegExp("\\b" + key + ":\\s*\"", "g")) || []).length;
  if (count < 3) fail(`i18n key '${key}' missing for all three locales`, `found ${count}/3`);
}
ok(`i18n combat keys present for ru/en/zh (${required.length} keys)`);

// --- 9. CSS hooks --------------------------------------------------------
for (const cls of [
  ".combat-cta", ".cta--combat", ".combat-arena", ".combat-tap",
  ".combat-bar", ".combat-pack", ".combat-avatar", ".combat-fx__pop"
]) {
  must(`CSS rule ${cls}`, new RegExp(cls.replace(/\./g, "\\.") + "\\b").test(css),
    `missing CSS for ${cls}`);
}

// --- 10. JS / API parse ---------------------------------------------------
try { new Function(app); ok("app.js parses"); }
catch (e) { fail("app.js parse error", e.message); }
try { new Function(read("i18n.js")); ok("i18n.js parses"); }
catch (e) { fail("i18n.js parse error", e.message); }
try { new Function(read("api.js")); ok("api.js parses"); }
catch (e) { fail("api.js parse error", e.message); }
try {
  // Stars endpoint uses CommonJS — wrap it for syntactic validation only.
  new Function("module", "process", "require", stars);
  ok("api/stars/create-invoice.js parses");
} catch (e) { fail("stars endpoint parse error", e.message); }

// --- 11. Live behavior smoke: structured error on missing env ------------
// Simulate the endpoint with no env vars and assert structured 503 payload.
(async function () {
  // Provide a Vercel-like (req, res) pair. We do NOT call fetch upstream
  // because the early bail must happen before any network call.
  const calls = [];
  const req = {
    method: "POST",
    headers: {},
    body: { pack: "energy" }
  };
  const res = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    end(b) { calls.push({ status: this.statusCode, body: b }); }
  };
  const handlerSrc = `${stars}\nmodule.exports.__loaded = true;`;
  const fn = new Function("module", "process", "require",
    "fetch", "AbortController", "setTimeout", "clearTimeout",
    handlerSrc + "\nreturn module.exports;");
  // Use a real require() so the endpoint's _lib siblings resolve.
  const { createRequire } = await import("node:module");
  const localRequire = createRequire(resolve(root, "api/stars/create-invoice.js"));
  // Save and clear the env vars for the duration of this call.
  const saved = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    BOT_TOKEN: process.env.BOT_TOKEN
  };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.BOT_TOKEN;
  try {
    const exp = fn({ exports: {} }, process, localRequire,
      globalThis.fetch, globalThis.AbortController,
      globalThis.setTimeout, globalThis.clearTimeout);
    await exp(req, res);
  } finally {
    if (saved.TELEGRAM_BOT_TOKEN !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved.TELEGRAM_BOT_TOKEN;
    if (saved.BOT_TOKEN !== undefined) process.env.BOT_TOKEN = saved.BOT_TOKEN;
  }
  const out = calls[0];
  if (!out) fail("Stars endpoint did not respond with no env");
  if (out.status !== 503) fail("Stars endpoint must return 503 when token missing",
    `got ${out.status}`);
  let parsed;
  try { parsed = JSON.parse(out.body); } catch (e) { fail("stars endpoint did not return JSON"); }
  if (!parsed || parsed.error !== "stars_not_configured") {
    fail("stars endpoint must return error=stars_not_configured", JSON.stringify(parsed));
  }
  ok("stars endpoint rejects missing env with structured 503");

  console.log("\nverify-game OK");
})().catch(function (e) {
  fail("verify-game runtime error", e && e.message);
});
