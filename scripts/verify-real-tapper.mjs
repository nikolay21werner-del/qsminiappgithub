#!/usr/bin/env node
/* verify-real-tapper.mjs
   Production-real tapper smoke test:
   - Telegram initData validator module is present and parses
   - No hard-coded bot token anywhere
   - No localStorage/sessionStorage/indexedDB/cookies in FE sources
   - Frontend uses Telegram.WebApp.CloudStorage for persistence
   - /api/combat/state and /api/combat/tap endpoints exist and parse
   - /api/combat/tap rejects missing initData with 401 telegram_required
   - /api/combat/tap rejects out-of-range tap counts
   - /api/combat/state responds 200 in offline mode (no initData)
   - /api/stars/create-invoice returns signed payload metadata
   - /api/stars/fulfill module exists and rejects without initData
   - Top nav stays removed; bottom nav has no combat item
   - Overview CTA card still present
   Exits non-zero on any failure.
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";

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
const i18n = read("i18n.js");
const stars = read("api/stars/create-invoice.js");
const fulfill = read("api/stars/fulfill.js");
const stateSrc = read("api/combat/state.js");
const tapSrc = read("api/combat/tap.js");
const webhook = read("api/telegram/webhook.js");
const authSrc = read("api/_lib/telegram-auth.js");
const logicSrc = read("api/_lib/combat-logic.js");
const httpSrc = read("api/_lib/http.js");
const vercel = read("vercel.json");

// --- 1. Auth module exists and is wired ---------------------------------
must("api/_lib/telegram-auth.js parses",
  (() => { try { new Function("require, module, process", authSrc); return true; } catch (e) { return false; }})());
must("auth exports validateInitData",
  /module\.exports\s*=\s*\{[\s\S]*validateInitData/.test(authSrc));
must("auth uses HMAC SHA256 + WebAppData secret",
  /createHmac\(["']sha256["'],\s*["']WebAppData["']\)/.test(authSrc));
must("auth exports signCheckpoint/verifyCheckpoint",
  /signCheckpoint:\s*signCheckpoint/.test(authSrc) &&
  /verifyCheckpoint:\s*verifyCheckpoint/.test(authSrc));

// --- 2. No hard-coded bot token anywhere --------------------------------
const tokenPattern = /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/;
for (const [name, src] of [
  ["app.js", app], ["index.html", html], ["i18n.js", i18n],
  ["api/stars/create-invoice.js", stars],
  ["api/stars/fulfill.js", fulfill],
  ["api/combat/state.js", stateSrc],
  ["api/combat/tap.js", tapSrc],
  ["api/telegram/webhook.js", webhook],
  ["api/_lib/telegram-auth.js", authSrc],
  ["vercel.json", vercel]
]) {
  if (tokenPattern.test(src)) fail(`hard-coded bot token pattern detected in ${name}`);
}
ok("no hard-coded bot token pattern in tracked sources");

// --- 3. No banned client storage in FE sources --------------------------
// Match actual API usage (member access / function calls), not the word
// "localStorage" appearing inside a copy/disclosure string like
// "no cookies or localStorage".
const bannedPatterns = [
  /\blocalStorage\s*\.\s*[gs]et/i,
  /\bsessionStorage\s*\.\s*[gs]et/i,
  /\bwindow\.localStorage\b/,
  /\bwindow\.sessionStorage\b/,
  /\bindexedDB\.\s*open/,
  /document\.cookie\s*=/
];
for (const re of bannedPatterns) {
  for (const [name, src] of [["app.js", app], ["index.html", html], ["i18n.js", i18n]]) {
    if (re.test(src)) fail(`${name} uses banned storage API: ${re}`);
  }
}
ok("no localStorage/sessionStorage/indexedDB/document.cookie usage in FE sources");

// --- 4. FE uses Telegram CloudStorage ----------------------------------
must("frontend reads Telegram CloudStorage", /Telegram\.WebApp[\s\S]{0,80}CloudStorage|tgCloud\(/.test(app));
must("frontend persists signed checkpoints under qsi_combat_v1",
  /qsi_combat_v1/.test(app));

// --- 5. Endpoints parse + register --------------------------------------
for (const [name, src] of [
  ["state.js", stateSrc],
  ["tap.js", tapSrc],
  ["fulfill.js", fulfill],
  ["webhook.js", webhook],
  ["create-invoice.js", stars],
  ["telegram-auth.js", authSrc],
  ["combat-logic.js", logicSrc],
  ["http.js", httpSrc]
]) {
  try { new Function("module, require, process, fetch, AbortController, setTimeout, clearTimeout", src); ok(`${name} parses`); }
  catch (e) { fail(`${name} parse error`, e.message); }
}
must("vercel.json registers combat/state", /api\/combat\/state\.js/.test(vercel));
must("vercel.json registers combat/tap", /api\/combat\/tap\.js/.test(vercel));
must("vercel.json registers stars/fulfill", /api\/stars\/fulfill\.js/.test(vercel));
must("vercel.json registers telegram/webhook", /api\/telegram\/webhook\.js/.test(vercel));

// --- 6. Stars endpoint returns signed payload ---------------------------
must("Stars endpoint signs payload via auth.signCheckpoint",
  /signCheckpoint\(/.test(stars));
must("Stars endpoint returns payload_sig field",
  /payload_sig:\s*signedPayload/.test(stars));
must("fulfill endpoint requires initData",
  /telegram_required/.test(fulfill));
must("fulfill endpoint verifies invoice payload",
  /verifyCheckpoint\(\s*sigPayload\s*\)/.test(fulfill));

// --- 7. Top nav removed, bottom nav has no combat item ------------------
must("topnav class absent in HTML",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
const tabSection = html.match(/<nav[^>]*class="tabbar"[\s\S]*?<\/nav>/);
must("bottom tabbar present", !!tabSection);
const tabbarHtml = tabSection ? tabSection[0] : "";
must("no combat/tap entry in bottom nav",
  !/data-nav="combat"/.test(tabbarHtml) &&
  !/data-nav="tap"/.test(tabbarHtml) &&
  !/data-nav="game"/.test(tabbarHtml));
must("Overview CTA card present",
  /id="combat-cta-card"/.test(html) && /data-action="open-combat"/.test(html));

// --- 8. New UI hooks ----------------------------------------------------
for (const id of ["combat-mode", "combat-sync", "combat-xp", "combat-xp-bar",
  "combat-streak", "combat-boss-round", "combat-boost-energy",
  "combat-boost-damage", "combat-boost-revive", "combat-board-qp",
  "combat-board-lvl"]) {
  must(`UI hook #${id}`, html.includes(`id="${id}"`), `missing ${id}`);
}

// --- 9. Tap endpoint rejects missing initData & bounds taps -------------
const tapMod = await loadCJS("api/combat/tap.js");
{
  const res = await invoke(tapMod, { method: "POST", body: { batch: { taps: 1 } } });
  if (res.status !== 401) fail("tap rejects missing initData (got " + res.status + ")");
  ok("tap endpoint rejects missing initData with 401");
}
{
  // Bad initData (fake) → 401 telegram_auth_failed (or telegram_not_configured)
  process.env.TELEGRAM_BOT_TOKEN = "111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const res = await invoke(tapMod, {
    method: "POST",
    body: { initData: "user=%7B%22id%22%3A1%7D&auth_date=1&hash=" + "0".repeat(64) }
  });
  if (res.status !== 401 || !res.body.error) fail("tap rejects bad initData", JSON.stringify(res.body));
  ok("tap endpoint rejects forged initData");
}
{
  // Valid HMAC initData but taps out of range → 400 + taps_out_of_range
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  const userJson = JSON.stringify({ id: 12345 });
  const authDate = String(Math.floor(Date.now() / 1000));
  const params = [
    ["auth_date", authDate],
    ["user", userJson]
  ];
  const dcs = params.slice().sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(tok).digest();
  const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  const initData = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") + "&hash=" + hash;
  // taps=999 out of range
  const res = await invoke(tapMod, {
    method: "POST",
    body: {
      initData,
      batch: { taps: 999, startMs: Date.now() - 5000, endMs: Date.now(), symbol: "BTCUSDT", volatility: 1, nonce: "n1" }
    }
  });
  if (res.status !== 400 || !["taps_out_of_range", "batch_too_fast"].includes(res.body.error)) {
    fail("tap rejects out-of-range taps", JSON.stringify(res.body));
  }
  ok("tap endpoint bounds tap count");
}

// --- 10. /state cleanly handles missing initData ------------------------
const stateMod = await loadCJS("api/combat/state.js");
{
  const res = await invoke(stateMod, { method: "POST", body: {} });
  if (res.status !== 200) fail("/state must respond 200 without initData (got " + res.status + ")");
  if (!res.body.ok) fail("/state body must include ok=true");
  if (!["offline", "telegram", "unconfigured"].includes(res.body.mode)) {
    fail("/state must report mode");
  }
  ok("/state handles missing initData cleanly with mode=" + res.body.mode);
}

console.log("\nverify-real-tapper OK");

// ----- helpers -----
async function loadCJS(rel) {
  const src = read(rel);
  const mod = { exports: {} };
  // Run in the current process so require() resolves _lib siblings.
  const here = resolve(root, rel);
  const localRequire = (await import("node:module")).createRequire(here);
  const fn = new Function("module", "exports", "require", "process", "fetch", "AbortController", "setTimeout", "clearTimeout", src);
  fn(mod, mod.exports, localRequire, process, globalThis.fetch, globalThis.AbortController, globalThis.setTimeout, globalThis.clearTimeout);
  return mod.exports;
}

function invoke(handler, opts) {
  return new Promise((resolveP) => {
    const req = {
      method: opts.method || "POST",
      headers: opts.headers || {},
      body: opts.body,
      on: () => req,
      destroy: () => {}
    };
    const res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      end(b) {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { parsed = b; }
        resolveP({ status: this.statusCode, body: parsed, headers: this._headers });
      }
    };
    Promise.resolve(handler(req, res)).catch(() => {});
  });
}
