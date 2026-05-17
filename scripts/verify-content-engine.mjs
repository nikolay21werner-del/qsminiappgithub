#!/usr/bin/env node
/* verify-content-engine.mjs
 *
 * Locks in the QUANTSIGNAL AI Content Engine MVP:
 *   - api/_lib/market.js, content-engine.js, brand-image.js exist + parse
 *   - api/content/preview.js + api/content/publish.js exist + parse
 *   - preview endpoint: public, no secret, returns required shape fields
 *   - publish endpoint: secret-gated via QSI_CRON_SECRET / CRON_SECRET,
 *     respects QSI_CHANNEL_POSTING_ENABLED, uses canonical label JPEG
 *     via sendPhoto, never posts without auth
 *   - content engine generates RU copies that include QUANTSIGNAL AI
 *     branding + bot CTA + disclaimer for every post type
 *   - brand image generator includes QUANTSIGNAL AI mark + bot link in
 *     the generated SVG
 *   - admin UI exists at admin/index.html, is mobile-friendly, has
 *     noindex meta, doesn't expose secrets, doesn't trigger publishes
 *     from the browser
 *   - vercel.json registers the new functions
 *   - no Telegram bot token / Authorization Bearer literal in source
 *   - existing endpoints + UI surfaces remain intact (no game,
 *     partner-ad present, bot/channel post still wired, splash label)
 *   - npm script verify:content-engine is registered
 */

import { readFileSync, existsSync } from "node:fs";
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

// ---- 1. New library files exist ----------------------------------------
const libPaths = [
  "api/_lib/market.js",
  "api/_lib/content-engine.js",
  "api/_lib/brand-image.js"
];
for (const p of libPaths) {
  must(p + " exists", existsSync(join(root, p)));
}

// ---- 2. New endpoint files exist ---------------------------------------
const endpoints = ["api/content/preview.js", "api/content/publish.js"];
for (const p of endpoints) {
  must(p + " exists", existsSync(join(root, p)));
}

const market     = read("api/_lib/market.js");
const engine     = read("api/_lib/content-engine.js");
const brand      = read("api/_lib/brand-image.js");
const preview    = read("api/content/preview.js");
const publish    = read("api/content/publish.js");
const adminHtml  = read("admin/index.html");
const vercelJson = JSON.parse(read("vercel.json"));
const pkg        = JSON.parse(read("package.json"));
const channelPost= read("api/channel/post.js");
const html       = read("index.html");
const app        = read("app.js");

// ---- 3. Market lib ------------------------------------------------------
must("market lib uses Promise.allSettled",
  /Promise\.allSettled/.test(market));
must("market lib covers BTC/ETH/SOL/TON/DOGE",
  /BTC[\s\S]*ETH[\s\S]*SOL[\s\S]*TON[\s\S]*DOGE/.test(market));
must("market lib has bybit -> coinbase -> kraken fallback",
  /api\.bybit\.com/.test(market) &&
  /api\.exchange\.coinbase\.com/.test(market) &&
  /api\.kraken\.com/.test(market));
must("market lib enforces an upstream timeout (AbortController)",
  /AbortController/.test(market) && /UPSTREAM_TIMEOUT_MS/.test(market));
must("market lib exports fetchSnapshot",
  /fetchSnapshot/.test(market));

// ---- 4. Content engine --------------------------------------------------
must("content engine declares 4 post types",
  /market_update/.test(engine) && /signal_idea/.test(engine) &&
  /coin_focus/.test(engine) && /ai_radar/.test(engine));
must("content engine exports planForType",
  /planForType/.test(engine));
must("content engine uses Russian copy by default (Сводка/Сигнал/Разбор/Радар)",
  /Сводка рынка/.test(engine) && /Сигнал-идея/.test(engine) &&
  /Разбор/.test(engine) && /Радар/.test(engine));
must("content engine includes QUANTSIGNAL AI brand tag",
  /QUANTSIGNAL AI/.test(engine));
must("content engine includes bot CTA link to t.me/QUANTSIGNAL_AI_BOT",
  /t\.me\/QUANTSIGNAL_AI_BOT/.test(engine));
must("content engine includes risk disclaimer",
  /Не финансовая рекомендация/.test(engine));
must("content engine computes bias / confidence / risk",
  /biasLabel/.test(engine) && /confidenceFor/.test(engine) && /riskFor/.test(engine));
must("content engine has deterministic levels helper (entry/stop/targets)",
  /levelsFor/.test(engine));
must("content engine escapes HTML",
  /escapeHtml/.test(engine));

// ---- 5. Brand image generator -------------------------------------------
must("brand image renderer exports renderForPlan",
  /renderForPlan/.test(brand));
must("brand image SVG includes QUANTSIGNAL AI mark",
  /QUANTSIGNAL AI/.test(brand));
must("brand image SVG includes bot link t.me/QUANTSIGNAL_AI_BOT",
  /t\.me\/QUANTSIGNAL_AI_BOT/.test(brand));
must("brand image returns SVG content-type",
  /image\/svg\+xml/.test(brand));
must("brand image renderer has no sharp/satori/canvas dependency",
  !/require\(["']sharp["']\)/.test(brand) &&
  !/require\(["']satori["']\)/.test(brand) &&
  !/require\(["']canvas["']\)/.test(brand));
must("brand image escapes XML",
  /escapeXml/.test(brand));

// ---- 6. Preview endpoint -----------------------------------------------
must("preview endpoint exports a handler",
  /module\.exports\s*=\s*async function/.test(preview));
must("preview endpoint accepts a `type` query parameter",
  /searchParams\.get\("type"\)/.test(preview));
must("preview endpoint accepts a `symbol` query parameter",
  /searchParams\.get\("symbol"\)/.test(preview));
must("preview endpoint imports the content engine",
  /require\(["']\.\.\/_lib\/content-engine["']\)/.test(preview));
must("preview endpoint imports the brand image generator",
  /require\(["']\.\.\/_lib\/brand-image["']\)/.test(preview));
must("preview endpoint returns ok / caption_html / image_svg_base64",
  /\bok:\s*true\b/.test(preview) &&
  /caption_html/.test(preview) &&
  /image_svg_base64/.test(preview));
must("preview endpoint exposes canonical label image_path",
  /image_path/.test(preview) &&
  /assets\/telegram\/quantsignal-label\.jpeg/.test(preview));
must("preview endpoint reports warnings array",
  /warnings/.test(preview));
must("preview endpoint does NOT call Telegram API",
  !/api\.telegram\.org/.test(preview));
must("preview endpoint does NOT require a secret",
  !/QSI_CRON_SECRET/.test(preview) && !/CRON_SECRET/.test(preview));

// ---- 7. Publish endpoint -----------------------------------------------
must("publish endpoint exports a handler",
  /module\.exports\s*=\s*async function/.test(publish));
must("publish endpoint is gated on QSI_CRON_SECRET / CRON_SECRET",
  /QSI_CRON_SECRET/.test(publish) && /CRON_SECRET/.test(publish));
must("publish endpoint checks Authorization: Bearer",
  /Bearer\s/.test(publish) && /authorization/i.test(publish));
must("publish endpoint requires the secret to be present (no anonymous publish)",
  /if\s*\(!secret\)\s*return\s+false/.test(publish));
must("publish endpoint gated on QSI_CHANNEL_POSTING_ENABLED === \"1\"",
  /QSI_CHANNEL_POSTING_ENABLED[\s\S]*===\s*"1"/.test(publish));
must("publish endpoint reads TELEGRAM_BOT_TOKEN or BOT_TOKEN",
  /TELEGRAM_BOT_TOKEN/.test(publish) && /BOT_TOKEN/.test(publish));
must("publish endpoint reads QSI_TELEGRAM_CHANNEL_ID or TELEGRAM_CHANNEL_ID",
  /QSI_TELEGRAM_CHANNEL_ID/.test(publish) && /TELEGRAM_CHANNEL_ID/.test(publish));
must("publish endpoint uses sendPhoto with canonical label JPEG",
  /\/sendPhoto/.test(publish) &&
  /assets\/telegram\/quantsignal-label\.jpeg/.test(publish));
must("publish endpoint supports dry_run / preview parameter",
  /dry_run/.test(publish));
must("publish endpoint returns preview when posting disabled",
  /mode:\s*"preview"/.test(publish));

// ---- 8. Source has no hard-coded Telegram token ------------------------
for (const [name, src] of [
  ["preview.js", preview],
  ["publish.js", publish],
  ["content-engine.js", engine],
  ["brand-image.js", brand],
  ["market.js", market],
  ["admin/index.html", adminHtml]
]) {
  must("no hard-coded Telegram bot token literal in " + name,
    !/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(src));
  must("no Authorization: Bearer <literal> in " + name,
    !/Bearer\s+[A-Za-z0-9_-]{20,}/.test(src));
}

// ---- 9. Admin UI -------------------------------------------------------
must("admin/index.html exists",
  existsSync(join(root, "admin/index.html")));
must("admin UI has viewport meta for mobile",
  /viewport[^>]+width=device-width/.test(adminHtml));
must("admin UI marks itself noindex",
  /name="robots"[^>]+noindex/.test(adminHtml));
must("admin UI uses QUANTSIGNAL AI branding",
  /QUANTSIGNAL AI/.test(adminHtml));
must("admin UI references canonical brand label image",
  /assets\/telegram\/quantsignal-label\.jpeg/.test(adminHtml));
must("admin UI includes all 4 post types in selector",
  /value="market_update"/.test(adminHtml) &&
  /value="signal_idea"/.test(adminHtml) &&
  /value="coin_focus"/.test(adminHtml) &&
  /value="ai_radar"/.test(adminHtml));
must("admin UI includes the 5 supported symbols",
  /value="BTC"/.test(adminHtml) && /value="ETH"/.test(adminHtml) &&
  /value="SOL"/.test(adminHtml) && /value="TON"/.test(adminHtml) &&
  /value="DOGE"/.test(adminHtml));
must("admin UI calls the preview endpoint",
  /api\/content\/preview/.test(adminHtml));
must("admin UI does NOT call the publish endpoint from the browser",
  !/fetch\([^)]*api\/content\/publish/.test(adminHtml));
must("admin UI does NOT embed any secret value",
  !/QSI_CRON_SECRET\s*=\s*["'][^"']{4,}/.test(adminHtml) &&
  !/CRON_SECRET\s*=\s*["'][^"']{4,}/.test(adminHtml));

// ---- 10. vercel.json registrations -------------------------------------
must("vercel.json registers api/content/preview.js",
  vercelJson.functions && "api/content/preview.js" in vercelJson.functions);
must("vercel.json registers api/content/publish.js",
  vercelJson.functions && "api/content/publish.js" in vercelJson.functions);
must("vercel.json still registers api/channel/post.js (legacy poster untouched)",
  vercelJson.functions && "api/channel/post.js" in vercelJson.functions);
// Hobby-safe: no Vercel cron added for the new endpoints either.
const cronsForContent = Array.isArray(vercelJson.crons)
  ? vercelJson.crons.filter(function (c) {
      return c && typeof c.path === "string" && c.path.indexOf("/api/content/") === 0;
    })
  : [];
must("vercel.json does NOT declare a cron for /api/content/* (Hobby-safe)",
  cronsForContent.length === 0);

// ---- 11. package.json verify script --------------------------------------
must("npm run verify:content-engine is registered",
  pkg.scripts && pkg.scripts["verify:content-engine"] === "node scripts/verify-content-engine.mjs");

// ---- 12. Surrounding shell still intact ---------------------------------
must("no Crypto Combat / tap game markup reintroduced",
  !/id="combat-cta-card"/.test(html) &&
  !/QSI_COMBAT/.test(app) &&
  !/\/api\/combat\b/.test(app));
must("Antarctic partner card still present",
  /id="partner-antarctic"/.test(html));
must("bottom tabbar still intact (overview/signals/market/ai/profile)",
  /<nav\s+class="tabbar"/.test(html) &&
  /data-nav="overview"/.test(html) &&
  /data-nav="market"/.test(html) &&
  /data-nav="ai"/.test(html));
must("existing channel-post endpoint untouched (still posts canonical label)",
  /assets\/telegram\/quantsignal-label\.jpeg/.test(channelPost) &&
  /\/sendPhoto/.test(channelPost));
must("docs file CONTENT_ENGINE.md exists",
  existsSync(join(root, "CONTENT_ENGINE.md")));

// ---- 13. JS parse check -------------------------------------------------
const toCheck = [
  "app.js", "i18n.js", "api.js",
  "api/ai/chat.js", "api/bybit/[endpoint].js",
  "api/_lib/http.js", "api/_lib/market.js",
  "api/_lib/content-engine.js", "api/_lib/brand-image.js",
  "api/channel/post.js",
  "api/content/preview.js", "api/content/publish.js",
  "api/telegram/bot-webhook.js"
];
for (const rel of toCheck) {
  const abs = join(root, rel);
  if (!existsSync(abs)) { failed++; console.error("  FAIL missing " + rel); continue; }
  try {
    execFileSync(process.execPath, ["--check", abs], { stdio: "pipe" });
    console.log("  ok   parses " + rel);
  } catch (e) {
    failed++;
    console.error("  FAIL parses " + rel + "  — " + (e.stderr ? e.stderr.toString().trim() : e.message));
  }
}

if (failed) {
  console.error("\nverify-content-engine: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-content-engine OK");
