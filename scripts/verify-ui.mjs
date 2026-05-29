#!/usr/bin/env node
/* verify-ui.mjs
 *
 * Locks in the QUANTSIGNAL AI Mini App premium "wallet / AI-terminal"
 * design system v3. Goal: prevent silent regressions on the visual
 * polish layer added after the wallet-style redesign.
 *
 * Checks fall into buckets:
 *   1. The v3 design layer is present and uses the QSI brand tokens.
 *   2. The wallet-style status pills live on the hero card.
 *   3. The glass dock (floating tabbar) styling is in place.
 *   4. Topbar / brand image keep the canonical QUANTSIGNAL AI label.
 *   5. No GitHub literal text or trade-dress leaked into the UI.
 *
 * Exits non-zero on any failure.
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

const css  = read("styles.css");
const html = read("index.html");
const app  = read("app.js");
const pkg  = JSON.parse(read("package.json"));

// ---- 1. v3 design layer ------------------------------------------------
must("v3 design layer header present",
  /DESIGN SYSTEM v3[\s\S]{0,200}Premium Wallet/.test(css));
must("--qsi-graphite-0 brand token defined",
  /--qsi-graphite-0:\s*#05080f/.test(css));
must("--qsi-cyan brand token defined",
  /--qsi-cyan:\s*#26e6f2/.test(css));
must("--qsi-orange brand accent defined",
  /--qsi-orange:\s*#ff8a2b/.test(css));
must("v3 glass surface token defined",
  /--qsi-glass:/.test(css));
must("v3 dock shadow token defined",
  /--qsi-shadow-dock:/.test(css));

// ---- 2. Hero card — wallet status row ----------------------------------
must("hero card markup retains data-coin hook",
  /class="hero-card"[\s\S]{0,80}id="hero-card"/.test(html));
must("wallet-status row is inside hero card area",
  /class="wallet-status"[\s\S]{0,200}data-testid="wallet-status"/.test(html));
must("wallet-status has LIVE MARKET pill",
  /class="wallet-status__pill wallet-status__pill--live"[\s\S]{0,200}LIVE MARKET/.test(html));
must("wallet-status has AI ENGINE pill",
  /wallet-status__pill--ai[\s\S]{0,400}AI ENGINE/.test(html));
must("wallet-status has QSI brand pill",
  /wallet-status__pill--brand[\s\S]{0,80}>QSI</.test(html));
must("wallet-status CSS exists",
  /\.wallet-status\s*\{[\s\S]*?display:\s*flex/.test(css) &&
  /\.wallet-status__pill\s*\{/.test(css));
must("wallet-status pill is a rounded chip (pill radius)",
  /\.wallet-status__pill\s*\{[\s\S]*?border-radius:\s*999px/.test(css));
must("wallet-status dot pulses on live pill",
  /\.wallet-status__dot[\s\S]{0,200}animation:\s*pulse/.test(css));

// ---- 3. Hero card — premium look ---------------------------------------
must("v3 hero-card uses radial premium gradient",
  /\.hero-card\s*\{[\s\S]{0,400}radial-gradient[\s\S]{0,400}var\(--qsi-glass\)/.test(css));
must("v3 hero-card pins border-radius >=22px",
  /\.hero-card\s*\{[\s\S]{0,400}border-radius:\s*2[2-9]px/.test(css));
must("v3 hero-card carries shadow-hero",
  /box-shadow:\s*var\(--qsi-shadow-hero\)/.test(css));
must("v3 hero price uses large display weight",
  /\.hero-card__price\s*\{[\s\S]{0,200}font-size:\s*2[6-9]px/.test(css));

// ---- 4. Floating glass dock --------------------------------------------
must("v3 tabbar floats above safe-area",
  /\.tabbar\s*\{[\s\S]{0,400}bottom:\s*calc\(\s*8px\s*\+\s*env\(safe-area-inset-bottom\)/.test(css));
must("v3 tabbar has rounded dock corners (>=18px)",
  /\.tabbar\s*\{[\s\S]{0,600}border-radius:\s*[12][0-9]px/.test(css));
must("v3 tabbar uses backdrop-filter blur",
  /\.tabbar\s*\{[\s\S]{0,600}backdrop-filter:\s*blur\(/.test(css));
must("active tab glows cyan",
  /\.tab\.is-active\s*\{[\s\S]{0,300}rgba\(38,\s*230,\s*242/.test(css));

// ---- 5. Topbar refinement ---------------------------------------------
must("v3 topbar height pinned >=52px",
  /\.topbar\s*\{[\s\S]{0,400}min-height:\s*5[2-9]px/.test(css));
must("topbar still uses the canonical QUANTSIGNAL AI label image",
  /class="topbar__label"[\s\S]{0,200}assets\/telegram\/quantsignal-label\.jpeg/.test(html));
must("topbar label image declares width + height attributes",
  /class="topbar__label"[\s\S]{0,300}width="\d+"\s+height="\d+"/.test(html));

// ---- 6. No GitHub trade-dress or literals -----------------------------
must("no GitHub literal text in HTML",
  !/github\.com|github\.io|GitHub\b/i.test(html));
must("no GitHub literal text in CSS",
  !/github\.com|GitHub\b/i.test(css));
must("no GitHub asset path referenced",
  !/assets?\/github/i.test(html) && !/assets?\/github/i.test(css));
must("Octocat / Mona / Hubot asset names absent",
  !/octocat|hubot|mona/i.test(html) && !/octocat|hubot|mona/i.test(css));

// ---- 7. No game / tap mechanic reintroduced ---------------------------
must("no Crypto Combat / tap game markup reintroduced",
  !/id="combat-cta-card"/.test(html) &&
  !/QSI_COMBAT/.test(app) &&
  !/\/api\/combat\b/.test(app));

// ---- 8. Bottom nav still intact (5 targets) ---------------------------
must("bottom tabbar still has 5 data-nav targets",
  /<nav\s+class="tabbar"/.test(html) &&
  /data-nav="overview"/.test(html) &&
  /data-nav="signals"/.test(html) &&
  /data-nav="market"/.test(html) &&
  /data-nav="ai"/.test(html) &&
  /data-nav="profile"/.test(html));

// ---- 9. Antarctic partner card still present --------------------------
must("Antarctic partner card untouched",
  /id="partner-antarctic"/.test(html) &&
  /data-testid="partner-antarctic"/.test(html));

// ---- 10. Keyboard-open contract still honoured by v3 layer ------------
must("v3 keyboard-open .app override is present (smaller padding when typing)",
  /body\.keyboard-open\s+\.app\s*\{[\s\S]{0,200}padding-bottom:\s*calc\(\s*12px/.test(css));
must("CSS hides the bottom tabbar while keyboard is open",
  /body\.keyboard-open\s+\.tabbar\s*\{[\s\S]*?(opacity:\s*0|display:\s*none|transform:\s*translate)/.test(css));

// ---- 11. Promo-wallet (v4) layer — reference composition -------------
// The Overview screen should mirror the reference: bold QUANTSIGNAL AI
// heading up top, a prominent circular badge as the hero anchor, and a
// row of three tilted phone-style cards (Market / Signals / AI) below.
must("v4 design layer header present",
  /DESIGN SYSTEM v4[\s\S]{0,200}Promo Wallet/.test(css));
must("v4 deeper-black canvas token defined",
  /--qsi-ink-black:\s*#02050b/.test(css));
must("v4 star sparkle styles present",
  /\.qsi-star\b[\s\S]{0,200}qsi-star-twinkle/.test(css));
must("v4 promo-hero block is flat (no card border, transparent bg)",
  /\.promo-hero\s*\{[\s\S]{0,500}background:\s*transparent/.test(css) &&
  /\.promo-hero\s*\{[\s\S]{0,500}border:\s*0/.test(css));
must("v4 promo-hero title is bold and large (>=26px clamp floor)",
  /\.promo-hero__title\s*\{[\s\S]{0,300}font-size:\s*clamp\(\s*2[6-9]px/.test(css) &&
  /\.promo-hero__title\s*\{[\s\S]{0,300}font-weight:\s*900/.test(css));
must("v4 circular qsi-badge uses clamp sizing (responsive hero anchor)",
  /\.qsi-badge\s*\{[\s\S]{0,400}border-radius:\s*50%/.test(css) &&
  /\.qsi-badge\s*\{[\s\S]{0,400}width:\s*clamp\(/.test(css));
must("v4 promo card mockups exist with tilt (3 items, ±rotate)",
  /\.promo-cards__item:nth-child\(1\)[\s\S]{0,200}rotate\(-[0-9.]+deg\)/.test(css) &&
  /\.promo-cards__item:nth-child\(3\)[\s\S]{0,200}rotate\([0-9.]+deg\)/.test(css));
must("v4 promo cards use phone-style notch header",
  /\.promo-cards__notch\s*\{/.test(css));
must("v4 promo cards width-capped (no horizontal overflow on 390px)",
  /\.promo-cards\s*\{[\s\S]{0,400}max-width:\s*3[0-9]{2}px/.test(css));

must("promo-hero markup present on overview",
  /class="promo-hero"[\s\S]{0,200}data-testid="promo-hero"/.test(html));
must("promo-hero title says QUANTSIGNAL AI (brand heading)",
  /class="promo-hero__title"[\s\S]{0,200}QUANTSIGNAL\s*<b>AI<\/b>/.test(html));
must("circular qsi-badge markup uses optimized asset",
  /class="qsi-badge"[\s\S]{0,400}assets\/telegram\/quantsignal-badge\.jpeg/.test(html));
must("qsi-badge image declares width + height attributes",
  /class="qsi-badge__img"[\s\S]{0,300}width="\d+"\s+height="\d+"/.test(html));
must("promo-hero has star sparkles",
  /class="qsi-stars"[\s\S]{0,200}class="qsi-star/.test(html));
must("promo-hero has at least 3 phone-style device cards",
  (html.match(/class="promo-cards__item/g) || []).length >= 3);
must("promo cards are actionable (Market / Signals / AI)",
  /data-action="open-market"/.test(html) &&
  /data-action="open-signals"/.test(html) &&
  /data-action="open-ai"/.test(html));
must("promo cards expose testids for each section",
  /data-testid="promo-card-market"/.test(html) &&
  /data-testid="promo-card-signals"/.test(html) &&
  /data-testid="promo-card-ai"/.test(html));
must("promo cards bind live values (balance / signals / ai-score)",
  /id="promo-balance"/.test(html) &&
  /id="promo-signals"/.test(html) &&
  /id="promo-ai-score"/.test(html));

// ---- 11c. Reference palette — black + cyan, no orange in canvas ------
{
  // The final body { ... } block (v4 layer) is the effective canvas style.
  // It must reference --qsi-ink-black and must NOT pull in orange/violet
  // wash so the page tone matches the reference (black + cyan only).
  const lastBodyIdx = css.lastIndexOf("\nbody {");
  const lastBody = lastBodyIdx >= 0 ? css.slice(lastBodyIdx, lastBodyIdx + 600) : "";
  must("final body background uses --qsi-ink-black",
    /var\(--qsi-ink-black\)/.test(lastBody));
  must("final body background has no orange tint",
    !/rgba\(255,\s*138,\s*43/.test(lastBody) &&
    !/rgba\(255,\s*155,\s*46/.test(lastBody));
  must("final body background has no violet tint",
    !/rgba\(123,\s*108,\s*255/.test(lastBody));
}
must("--qsi-cyan brand cyan still present (reference teal)",
  /--qsi-cyan:\s*#26e6f2/.test(css));

// ---- 11a. No "THANK YOU" or promo trade-dress leak --------------------
must("no THANK YOU / FOR WATCHING text in HTML",
  !/THANK\s*YOU|FOR\s*WATCHING/i.test(html));
must("no THANK YOU / FOR WATCHING text in CSS",
  !/THANK\s*YOU|FOR\s*WATCHING/i.test(css));

// ---- 11b. Asset budget — circular badge must be reasonably small -----
{
  const badgePath = join(root, "assets/telegram/quantsignal-badge.jpeg");
  if (existsSync(badgePath)) {
    const size = readFileSync(badgePath).byteLength;
    must("optimized badge asset is <=250KB", size <= 250 * 1024,
      "size=" + size + "B");
  } else {
    must("optimized badge asset exists", false,
      "missing assets/telegram/quantsignal-badge.jpeg");
  }
}

// ---- 12. package.json verify script entry -----------------------------
must("npm run verify:ui is registered",
  pkg.scripts && pkg.scripts["verify:ui"] === "node scripts/verify-ui.mjs");

// ---- 13. JS parse check (sanity) --------------------------------------
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
  console.error("\nverify-ui: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-ui OK");
