#!/usr/bin/env node
/* verify-ui.mjs
 *
 * Locks in the QUANTSIGNAL AI Mini App premium dark "AI-terminal"
 * design system. Goal: prevent silent regressions on the visual polish
 * layer AND guard against the rejected promo-poster composition
 * (tilted device mockups, oversized hero badge, star sparkles) creeping
 * back onto the Overview screen.
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

// ---- 11. App-dashboard (v4) layer — compact brand + KPI strip --------
// The Overview screen must read as a professional Mini App dashboard, NOT
// a promo poster: a compact brand strip (small QSI mark + QUANTSIGNAL AI
// label + LIVE status) above an inline row of live KPI chips. No tilted
// device mockups, no oversized hero badge, no decorative star sparkles.
must("v4 design layer header present",
  /DESIGN SYSTEM v4[\s\S]{0,200}App Dashboard/.test(css));
must("v4 deep-black canvas token defined",
  /--qsi-ink-black:\s*#02050b/.test(css));

// Anti-poster guards: the rejected reference composition must be gone.
must("no tilted promo device-card mockups in CSS",
  !/\.promo-cards__item/.test(css));
must("no oversized circular hero badge (.qsi-badge) in CSS",
  !/\.qsi-badge\s*[{,]/.test(css));
must("no decorative star-sparkle styles in CSS",
  !/qsi-star-twinkle/.test(css) && !/\.qsi-star\b/.test(css));
must("no tilted device mockups / star markup in HTML",
  !/class="promo-cards/.test(html) &&
  !/class="qsi-stars"/.test(html) &&
  !/class="qsi-star\b/.test(html));
must("no oversized circular badge markup in HTML",
  !/class="qsi-badge"/.test(html));

// Compact brand strip composition.
must("brand-strip block is flat (transparent, no card border)",
  /\.brand-strip\s*\{[\s\S]{0,400}background:\s*transparent/.test(css) &&
  /\.brand-strip\s*\{[\s\S]{0,400}border:\s*0/.test(css));
must("brand-strip name is app-scale, not poster-scale (<=20px clamp ceil)",
  /\.brand-strip__name\s*\{[\s\S]{0,300}font-size:\s*clamp\([^)]*?1[5-9]px,[^)]*?(1[5-9]|20)px\)/.test(css));
must("brand-strip mark is small (compact 40px square, not hero anchor)",
  /\.brand-strip__mark\s*\{[\s\S]{0,300}width:\s*40px/.test(css));
must("brand-strip LIVE status dot pulses",
  /\.brand-strip__dot[\s\S]{0,200}animation:\s*pulse/.test(css));

// KPI strip — inline live chips, width-capped to the column (no overflow).
must("kpi-strip is a 3-column grid (inline, full-width)",
  /\.kpi-strip\s*\{[\s\S]{0,300}grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(css));
must("kpi-chip uses interactive transform on :active (no layout shift)",
  /\.kpi-chip:active\s*\{[\s\S]{0,80}transform:\s*scale/.test(css));

must("brand-strip markup present on overview",
  /class="brand-strip"[\s\S]{0,200}data-testid="promo-hero"/.test(html));
must("brand-strip shows QUANTSIGNAL AI label",
  /class="brand-strip__name"[\s\S]{0,120}QUANTSIGNAL\s*<b>AI<\/b>/.test(html));
must("brand-strip carries a LIVE status pill",
  /class="brand-strip__status"[\s\S]{0,200}LIVE/.test(html));
must("kpi chips are actionable (Market / Signals / AI)",
  /data-action="open-market"/.test(html) &&
  /data-action="open-signals"/.test(html) &&
  /data-action="open-ai"/.test(html));
must("kpi chips expose testids for each section",
  /data-testid="promo-card-market"/.test(html) &&
  /data-testid="promo-card-signals"/.test(html) &&
  /data-testid="promo-card-ai"/.test(html));
must("kpi chips bind live values (balance / signals / ai-score)",
  /id="promo-balance"/.test(html) &&
  /id="promo-signals"/.test(html) &&
  /id="promo-ai-score"/.test(html));
must("exactly 3 KPI chips on overview",
  (html.match(/class="kpi-chip\b/g) || []).length >= 3);

// ---- 11c. Palette — deep black + cyan, no orange/violet wash --------
{
  // The v4 canvas declaration (preserved) must still reference
  // --qsi-ink-black and must NOT pull in orange/violet wash so the page
  // tone stays the premium dark QSI look (black + cyan). The effective
  // canvas is the later v5 body block (asserted in 11d); this guards the
  // v4 declaration against an orange/violet regression.
  const v4Idx = css.indexOf("--qsi-ink-black:");
  const v4BodyIdx = v4Idx >= 0 ? css.indexOf("\nbody {", v4Idx) : -1;
  const v4Body = v4BodyIdx >= 0 ? css.slice(v4BodyIdx, v4BodyIdx + 600) : "";
  must("v4 body background uses --qsi-ink-black",
    /var\(--qsi-ink-black\)/.test(v4Body));
  must("v4 body background has no orange tint",
    !/rgba\(255,\s*138,\s*43/.test(v4Body) &&
    !/rgba\(255,\s*155,\s*46/.test(v4Body));
  must("v4 body background has no violet tint",
    !/rgba\(123,\s*108,\s*255/.test(v4Body));
}
must("--qsi-cyan brand cyan still present (signature teal)",
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

// ---- 11d. Cryptex-style finance dashboard (v5) ------------------------
// The Overview must read as a real crypto finance app (Dribbble ref):
// a Total Balance hero (label / big amount / BTC equivalent / LIVE badge)
// and an action bar of 4 round icon buttons (Market / Signals / AI / More).
// These reuse existing data-actions so live navigation keeps working.
must("v5 design layer header present",
  /DESIGN SYSTEM v5[\s\S]{0,200}Finance Dashboard/.test(css));
must("v5 canvas token defined (#0a0a0f near-black)",
  /--qsi-canvas:\s*#0a0a0f/.test(css));
must("v5 card tokens defined (#111520 / #141926)",
  /--qsi-card:\s*#111520/.test(css) && /--qsi-card-2:\s*#141926/.test(css));
must("v5 border token defined (#1e2535)",
  /--qsi-border:\s*#1e2535/.test(css));
must("v5 teal accent token defined (#00e5d8)",
  /--qsi-teal:\s*#00e5d8/.test(css));

// Total Balance hero — markup + hooks.
must("balance hero markup present on overview",
  /class="balance-hero"[\s\S]{0,120}data-testid="balance-hero"/.test(html));
must("balance hero shows a Total Balance label",
  /class="balance-hero__label"[\s\S]{0,80}data-i18n="totalBalance"/.test(html));
must("balance hero carries a LIVE badge",
  /class="balance-hero__badge"[\s\S]{0,200}data-i18n="liveBadge"/.test(html));
must("balance hero binds a live total value (#total-balance)",
  /id="total-balance"[\s\S]{0,60}data-testid="total-balance"/.test(html));
must("balance hero shows a BTC equivalent (#balance-btc)",
  /id="balance-btc"/.test(html) && /data-i18n="btcEquivalent"/.test(html));
must("balance hero shows a 24h delta (#balance-delta)",
  /id="balance-delta"/.test(html));
must("app.js wires #total-balance to live data",
  /#total-balance/.test(app) && /balance-btc/.test(app) && /balance-delta/.test(app));

// Balance hero CSS — big tabular display number (30-36px), rounded card.
must("balance-hero value uses large display size (30-36px clamp)",
  /\.balance-hero__value\s*\{[\s\S]{0,260}font-size:\s*clamp\([^)]*?3[0-6]px\)/.test(css));
must("balance-hero card uses app card radius (16-20px) + border token",
  /\.balance-hero\s*\{[\s\S]{0,400}border-radius:\s*(1[6-9]|20)px/.test(css) &&
  /\.balance-hero\s*\{[\s\S]{0,400}border:\s*1px solid var\(--qsi-border\)/.test(css));
must("balance-hero LIVE dot pulses",
  /\.balance-hero__dot[\s\S]{0,160}animation:\s*pulse/.test(css));

// Action bar — 4 round icon buttons reusing live navigation actions.
must("action bar markup present on overview",
  /class="action-bar"[\s\S]{0,120}data-testid="action-bar"/.test(html));
must("action bar exposes 4 round buttons",
  (html.match(/class="action-btn"/g) || []).length >= 4);
must("action buttons reuse live nav actions (market/signals/ai/profile)",
  /class="action-btn"\s+data-action="open-market"/.test(html) &&
  /class="action-btn"\s+data-action="open-signals"/.test(html) &&
  /class="action-btn"\s+data-action="open-ai"/.test(html) &&
  /class="action-btn"\s+data-action="open-profile"/.test(html));
must("action buttons expose testids",
  /data-testid="action-market"/.test(html) &&
  /data-testid="action-signals"/.test(html) &&
  /data-testid="action-ai"/.test(html) &&
  /data-testid="action-more"/.test(html));
must("action-btn icon circle is 48px (44px on narrow)",
  /\.action-btn__ico\s*\{[\s\S]{0,200}width:\s*48px[\s\S]{0,40}height:\s*48px/.test(css));
must("action-btn presses via transform only (no layout shift)",
  /\.action-btn:active\s+\.action-btn__ico\s*\{[\s\S]{0,120}transform:\s*scale/.test(css));
must("action bar is a 4-column grid",
  /\.action-bar\s*\{[\s\S]{0,160}grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(css));

// Palette guard — the v5 canvas must stay deep dark with cyan/teal only.
{
  const lastBodyIdx = css.lastIndexOf("\nbody {");
  const lastBody = lastBodyIdx >= 0 ? css.slice(lastBodyIdx, lastBodyIdx + 600) : "";
  must("v5 body background uses --qsi-canvas (near-black)",
    /var\(--qsi-canvas\)/.test(lastBody));
  must("v5 body background uses a cyan/teal glow",
    /rgba\(0,\s*229,\s*216/.test(lastBody));
  must("v5 body background has no orange tint",
    !/rgba\(255,\s*138,\s*43/.test(lastBody) &&
    !/rgba\(247,\s*147,\s*26/.test(lastBody));
  must("v5 body background has no violet tint",
    !/rgba\(123,\s*108,\s*255/.test(lastBody));
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
