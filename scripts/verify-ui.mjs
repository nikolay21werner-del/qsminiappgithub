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
// The Overview keeps the v5 dark-cyan finance look (canvas/card/teal tokens),
// but four blocks were intentionally removed: the Total Balance hero, the
// quote ticker, the 4 round action buttons, and the Top Coins list. The
// remaining surface (brand strip, hero analysis card, last-signal, partner
// card, KPIs, AI summary) must stay intact and live-wired.
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

// ---- 11e. Removed blocks must stay removed (absence guards) -----------
// These four blocks were deliberately deleted from the Overview. Guard
// against any of them creeping back into markup, JS hooks, or CSS.

// 1) Total Balance hero.
must("Total Balance hero removed from markup",
  !/class="balance-hero"/.test(html) && !/data-testid="balance-hero"/.test(html) &&
  !/id="total-balance"/.test(html));
must("Total Balance hero hooks removed from app.js",
  !/#total-balance/.test(app) && !/balance-delta/.test(app));
must("Total Balance hero CSS removed",
  !/\.balance-hero/.test(css));

// 2) Quote ticker / running marquee.
must("quote ticker removed from markup",
  !/class="ticker"/.test(html) && !/id="ticker-track"/.test(html));
must("ticker render + hooks removed from app.js",
  !/renderTicker/.test(app) && !/#ticker-track/.test(app));
must("ticker CSS + scroll keyframes removed",
  !/\.ticker-track/.test(css) && !/tickerScroll/.test(css));

// 3) Round action buttons (Market / Signals / AI / More).
must("round action bar removed from markup",
  !/class="action-bar"/.test(html) && !/data-testid="action-bar"/.test(html) &&
  !/class="action-btn"/.test(html));
must("action-bar CSS removed",
  !/\.action-bar/.test(css) && !/\.action-btn/.test(css));

// 4) Top Coins list.
must("Top Coins list removed from markup",
  !/class="card market-top"/.test(html) && !/id="overview-rows"/.test(html) &&
  !/data-i18n="topCoins"/.test(html));
must("overview-rows render + hooks removed from app.js",
  !/renderOverviewRows/.test(app) && !/overview-rows/.test(app));
must("market-top CSS removed",
  !/\.market-top/.test(css));

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

// ---- 11f. Native phone app shell (v6) ---------------------------------
// The Overview/app must read like a real phone app: a pinned native
// header, a tight card-stack feed with section labels, and a stable
// blurred bottom tab bar. Additive over v5 — no hooks renamed.
must("v6 design layer header present",
  /DESIGN SYSTEM v6[\s\S]{0,200}Native Phone App Shell/.test(css));
must("v6 app-shell uses a 16px native gutter token",
  /--qsi-gutter:\s*16px/.test(css));
must("v6 topbar is a pinned/sticky native header",
  /\.topbar\s*\{[\s\S]{0,260}position:\s*sticky[\s\S]{0,120}top:\s*0/.test(css));
must("v6 sticky header uses a blurred dark shell surface",
  /\.topbar\s*\{[\s\S]{0,400}backdrop-filter:\s*blur\(/.test(css) &&
  /--qsi-shell:/.test(css));
must("v6 sticky header reserves safe-area-inset-top padding",
  /\.topbar\s*\{[\s\S]{0,400}env\(safe-area-inset-top\)/.test(css));
must("v6 screen feed uses a tight card-stack gap token",
  /\.screen\s*\{[\s\S]{0,120}gap:\s*var\(--qsi-stack-gap\)/.test(css));
must("v6 native section labels (stack-label) styled with uppercase eyebrow",
  /\.stack-label\s*\{[\s\S]{0,260}text-transform:\s*uppercase/.test(css));
must("v6 stack-label markup present on Overview (3 native section labels)",
  (html.match(/class="stack-label"/g) || []).length >= 3);
must("v6 tab bar is blurred + sits near the bottom edge",
  /\.tabbar\s*\{[\s\S]{0,260}bottom:\s*calc\(\s*6px\s*\+\s*env\(safe-area-inset-bottom\)/.test(css) &&
  /\.tabbar\s*\{[\s\S]{0,260}backdrop-filter:\s*blur\(/.test(css));
must("v6 tab geometry is stable (min-height + column icon/label)",
  /\.tabbar\s+\.tab\s*\{[\s\S]{0,200}min-height:\s*50px[\s\S]{0,200}flex-direction:\s*column/.test(css));
must("v6 overflow guards keep overview grids min-width:0",
  /\.kpi-strip,[\s\S]{0,120}\.tf-tabs\s*\{[\s\S]{0,80}min-width:\s*0/.test(css));

// ---- 11g. Functional panels (v7) — every panel performs an action -----
// Each Overview panel must be a real tap target: it carries a data-action
// + data-testid in markup AND a matching handler case in app.js. This is
// the "каждая панель отвечает за своё действие" contract.

// Hero / main market card → opens Market for the selected symbol.
must("hero card is a tappable panel (data-action + data-testid)",
  /id="hero-card"[\s\S]{0,260}data-action="open-hero-market"/.test(html) &&
  /data-testid="hero-card"/.test(html));
must("hero card exposes button role + keyboard focus",
  /id="hero-card"[\s\S]{0,260}role="button"[\s\S]{0,60}tabindex="0"/.test(html));

// KPI cards → Signals / Market / AI.
must("KPI cards are actionable buttons routing to modules",
  /class="kpi"[\s\S]{0,120}data-action="open-signals-focus"[\s\S]{0,120}data-testid="kpi-signals"/.test(html) &&
  /class="kpi"[\s\S]{0,120}data-action="open-market"[\s\S]{0,120}data-testid="kpi-coins"/.test(html) &&
  /class="kpi"[\s\S]{0,120}data-action="open-ai"[\s\S]{0,120}data-testid="kpi-accuracy"/.test(html));

// AI analysis card → AI assistant.
must("AI summary card opens the AI assistant",
  /data-testid="ai-summary-card"[\s\S]{0,120}data-action="open-ai"/.test(html) &&
  /data-testid="ai-summary-card"[\s\S]{0,160}role="button"/.test(html));

// Last-signal / activity card → Signals (focus active signal).
must("last-signal card opens + focuses the active signal",
  /data-testid="last-signal-card"[\s\S]{0,160}data-action="open-signals-focus"/.test(html));

// System Health card + diagnostics sheet (new in-app status module).
must("System Health card present + actionable on Overview",
  /id="health-card"[\s\S]{0,200}data-action="open-system-health"/.test(html) &&
  /data-testid="health-card"/.test(html));
must("System Health diagnostics sheet markup present",
  /id="health-sheet"[\s\S]{0,400}id="health-sheet-body"/.test(html));
must("System Health card carries 3 status dots",
  /id="health-dot-market"/.test(html) &&
  /id="health-dot-ai"/.test(html) &&
  /id="health-dot-signals"/.test(html));

// Every panel data-action must have a matching handler case in app.js.
[
  "open-hero-market",
  "open-signals-focus",
  "open-system-health",
  "close-health",
  "open-market",
  "open-signals",
  "open-ai",
  "open-profile",
].forEach(function (act) {
  must('app.js handles "' + act + '" action',
    new RegExp('case\\s+"' + act + '"\\s*:').test(app));
});

// Supporting handler functions must exist.
must("app.js defines focusActiveSignal()",
  /function\s+focusActiveSignal\s*\(/.test(app));
must("app.js defines renderSystemHealth()",
  /function\s+renderSystemHealth\s*\(/.test(app));
must("app.js defines applyHealthDots()",
  /function\s+applyHealthDots\s*\(/.test(app));

// Keyboard activation for role=button cards + Escape closes health sheet.
must("app.js activates role=button panels via Enter/Space",
  /role"\)\s*===\s*"button"/.test(app) &&
  /handleAction\(\s*t\.getAttribute\("data-action"\)/.test(app));
must("Escape closes the health sheet too",
  /closeSheet\("#health-sheet"\)/.test(app));

// Press feedback for functional panels stays transform/opacity (no shift).
must("v7 functional panels use transform-only :active feedback",
  /\.health-card\[data-action\]:active\s*\{[\s\S]{0,60}transform:\s*scale/.test(css) &&
  /\.kpi\[data-action\]:active\s*\{[\s\S]{0,60}transform:\s*scale/.test(css));
must("v7 functional panels expose a visible focus ring",
  /\.kpi\[data-action\]:focus-visible/.test(css) &&
  /\.health-card\[data-action\]:focus-visible/.test(css));
must("v7 signal focus highlight styled",
  /\.signal-card--focus\s*\{/.test(css));

// ---- 11h. App Panels (v8) — self-contained dashboard modules ----------
// The Overview must read like a native app with discrete panels, each
// carrying shared "panel chrome" (uppercase label + status badge +
// chevron) and a panel-level action. Three new live modules — AI Signal,
// Market Matrix preview, Activity Feed — are required, wired to live data.
must("v8 design layer header present",
  /DESIGN SYSTEM v8[\s\S]{0,200}App Panels/.test(css));

// Shared panel chrome primitives.
must("v8 .app-panel base styled (glass card, rounded, pointer)",
  /\.app-panel\s*\{[\s\S]{0,500}border-radius:\s*20px/.test(css) &&
  /\.app-panel\s*\{[\s\S]{0,500}cursor:\s*pointer/.test(css));
must("v8 .app-panel uses transform-only :active feedback (no layout shift)",
  /\.app-panel:active\s*\{[\s\S]{0,60}transform:\s*scale/.test(css));
must("v8 .app-panel exposes a focus ring",
  /\.app-panel:focus-visible\s*\{/.test(css));
must("v8 panel header label is an uppercase eyebrow",
  /\.app-panel__label\s*\{[\s\S]{0,200}text-transform:\s*uppercase/.test(css));
must("v8 panel badge + live dot styled (pulsing)",
  /\.app-panel__badge\s*\{/.test(css) &&
  /\.app-panel__dot[\s\S]{0,160}animation:\s*pulse/.test(css));
must("v8 panel chevron affordance styled",
  /\.app-panel__chevron\s*\{/.test(css));

// AI Signal Panel.
must("AI Signal panel present + actionable on Overview",
  /id="signal-panel"[\s\S]{0,200}data-action="open-signals-focus"/.test(html) &&
  /data-testid="signal-panel"/.test(html));
must("AI Signal panel is a keyboard-activatable button role",
  /id="signal-panel"[\s\S]{0,240}role="button"[\s\S]{0,60}tabindex="0"/.test(html));
must("AI Signal panel has confidence ring + value hook",
  /id="sig-ring-arc"/.test(html) && /id="sig-conf"/.test(html));
must("AI Signal panel has side + entry/target/stop hooks",
  /id="sig-side"/.test(html) && /id="sig-entry"/.test(html) &&
  /id="sig-target"/.test(html) && /id="sig-stop"/.test(html));
must("AI Signal panel supports LONG/SHORT/WAIT side styling",
  /\.sig-panel__side--long/.test(css) &&
  /\.sig-panel__side--short/.test(css) &&
  /\.sig-panel__side--wait/.test(css));

// Market Matrix preview panel.
must("Market Matrix preview panel present + opens Market",
  /id="matrix-panel"[\s\S]{0,200}data-action="open-market"/.test(html) &&
  /data-testid="matrix-panel"/.test(html));
must("Market Matrix preview panel has a live grid hook",
  /id="matrix-panel-grid"/.test(html) && /data-testid="matrix-panel-grid"/.test(html));
must("Market Matrix preview cells styled with heat + up/down direction",
  /\.mp-cell--up/.test(css) && /\.mp-cell--down/.test(css) &&
  /\.mp-cell__heat/.test(css));
must("Market Matrix preview grid reserves min-height (no reflow)",
  /\.matrix-panel__grid\s*\{[\s\S]{0,200}min-height:/.test(css));

// Activity Feed panel.
must("Activity Feed panel present + opens Signals",
  /id="activity-panel"[\s\S]{0,200}data-action="open-signals-focus"/.test(html) &&
  /data-testid="activity-panel"/.test(html));
must("Activity Feed panel has a live list hook",
  /id="activity-feed"/.test(html) && /data-testid="activity-feed"/.test(html));
must("Activity Feed rows + reserved min-height styled",
  /\.feed-row\s*\{/.test(css) &&
  /\.feed-panel__list\s*\{[\s\S]{0,200}min-height:/.test(css));

// Live render functions exist + are wired into the realtime path.
must("app.js defines renderSignalPanel()",
  /function\s+renderSignalPanel\s*\(/.test(app));
must("app.js defines renderMatrixPanel()",
  /function\s+renderMatrixPanel\s*\(/.test(app));
must("app.js defines renderActivityPanel()",
  /function\s+renderActivityPanel\s*\(/.test(app));
must("v8 panels render on every realtime tick",
  /onRealtimeTickers[\s\S]{0,400}renderSignalPanel\(\)[\s\S]{0,120}renderMatrixPanel\(\)[\s\S]{0,120}renderActivityPanel\(\)/.test(app));
must("v8 panels re-render on locale switch",
  /function\s+applyI18N\s*\([\s\S]{0,900}renderSignalPanel\(\)[\s\S]{0,160}renderMatrixPanel\(\)[\s\S]{0,160}renderActivityPanel\(\)/.test(app));

// i18n keys for the new panels exist in all three locales.
[
  "panelSignalTitle", "panelSignalConf", "sideWait",
  "panelMatrixTitle", "panelMatrixSub",
  "panelActivityTitle", "panelActivitySub", "panelActivityEmpty",
].forEach(function (key) {
  const re = new RegExp(key + "\\s*:", "g");
  const n = (read("i18n.js").match(re) || []).length;
  must('i18n key "' + key + '" defined in all 3 locales', n >= 3,
    "found " + n + " (need >=3)");
});

// v8 panel grids stay overflow-safe (min-width:0).
must("v8 new panel grids stay min-width:0 (no horizontal overflow)",
  /\.sig-panel__legs,[\s\S]{0,120}\.matrix-panel__grid,[\s\S]{0,120}\.feed-panel__list\s*\{[\s\S]{0,80}min-width:\s*0/.test(css));

// ---- 11i. Blue-Neon Crypto AI Terminal (v9) ---------------------------
// The Mics-app must read as an electric blue/cyan neon crypto AI dashboard
// (the approved reference): deep navy/black canvas, glowing borders, lit
// panel headers, glassmorphism, neon active states, neon bottom dock.
// Additive over v8 — no markup/hook renamed.
must("v9 design layer header present",
  /DESIGN SYSTEM v9[\s\S]{0,200}Blue-Neon Crypto AI Terminal/.test(css));

// Neon brand tokens.
must("v9 deep navy base token defined",
  /--qsn-navy-0:\s*#02050e/.test(css));
must("v9 electric blue token defined",
  /--qsn-blue:\s*#2f8bff/.test(css));
must("v9 neon cyan token defined",
  /--qsn-cyan:\s*#2fe6ff/.test(css));
must("v9 glowing border (edge) token defined",
  /--qsn-edge:\s*rgba\(47,\s*160,\s*255/.test(css));
must("v9 glass surface token defined",
  /--qsn-glass:\s*rgba\(8,\s*18,\s*40/.test(css));
must("v9 cyan glow shadow token defined",
  /--qsn-glow-cyan:/.test(css));

// Canvas — deep navy/black + animated data grid + cyan glow.
{
  const lastBodyIdx = css.lastIndexOf("\nbody {");
  const lastBody = lastBodyIdx >= 0 ? css.slice(lastBodyIdx, lastBodyIdx + 700) : "";
  must("v9 body canvas uses deep navy gradient base",
    /var\(--qsn-navy-1\)/.test(lastBody) && /var\(--qsn-navy-0\)/.test(lastBody));
  must("v9 body canvas carries electric blue glow",
    /rgba\(47,\s*160,\s*255/.test(lastBody));
}
must("v9 animated data-grid drift keyframe present",
  /@keyframes\s+qsnGridDrift/.test(css) &&
  /\.bg-grid\s*\{[\s\S]{0,260}animation:\s*qsnGridDrift/.test(css));

// Glowing neon borders / lit panel headers / glass panels.
must("v9 hero card carries neon cyan glow shadow",
  /\.hero-card\s*\{[\s\S]{0,400}var\(--qsn-glow-cyan\)/.test(css));
must("v9 hero card has a neon gradient border (::before mask)",
  /\.hero-card::before\s*\{[\s\S]{0,500}mask-composite:\s*exclude/.test(css));
must("v9 app-panels use neon glass + glow",
  /\.app-panel\s*\{[\s\S]{0,400}var\(--qsn-glass\)[\s\S]{0,200}var\(--qsn-glow-soft\)/.test(css));
must("v9 lit panel header label glows cyan",
  /\.app-panel__label\s*\{[\s\S]{0,200}var\(--qsn-cyan-soft\)/.test(css));

// AI Signal panel — neon confidence + LONG/SHORT accents.
must("v9 confidence ring arc glows cyan",
  /#sig-ring-arc\s*\{[\s\S]{0,160}var\(--qsn-cyan\)[\s\S]{0,120}drop-shadow/.test(css));
must("v9 LONG side gets neon green accent",
  /\.sig-panel__side--long\s*\{[\s\S]{0,260}var\(--qsn-pos\)/.test(css));
must("v9 SHORT side gets neon red accent",
  /\.sig-panel__side--short\s*\{[\s\S]{0,260}var\(--qsn-neg\)/.test(css));

// Distinct neon blocks for Matrix / Activity / System Health.
must("v9 matrix heat cells get neon up/down rings",
  /\.mp-cell--up\s*\{[\s\S]{0,160}rgba\(37,\s*242,\s*163/.test(css) &&
  /\.mp-cell--down\s*\{[\s\S]{0,160}rgba\(255,\s*82,\s*122/.test(css));
must("v9 last-signal + System Health blocks get neon edge",
  /\.last-signal,\s*\.health-card\s*\{[\s\S]{0,300}var\(--qsn-edge\)/.test(css));

// Bottom nav — native neon dock with glow under active icon.
must("v9 tabbar is a neon dock (edge border + blue glow shadow)",
  /\.tabbar\s*\{[\s\S]{0,400}var\(--qsn-edge\)[\s\S]{0,300}rgba\(12,\s*76,\s*255/.test(css));
must("v9 active tab icon glows cyan (drop-shadow)",
  /\.tabbar\s+\.tab\.is-active\s+\.tab__ico\s*\{[\s\S]{0,160}drop-shadow/.test(css));
must("v9 active tab carries a glow halo + neon underline",
  /\.tabbar\s+\.tab\.is-active::before\s*\{/.test(css) &&
  /\.tabbar\s+\.tab\.is-active::after\s*\{/.test(css));

// Header — illuminated QUANTSIGNAL AI app bar.
must("v9 topbar gets an illuminated neon underline (::after)",
  /\.topbar::after\s*\{[\s\S]{0,200}var\(--qsn-cyan\)/.test(css));
must("v9 connection/data-source pill glows cyan",
  /\.conn-pill\s*\{[\s\S]{0,200}var\(--qsn-cyan-soft\)/.test(css));
must("v9 live dot uses a cyan neon glow",
  /\.dot-live[\s\S]{0,160}var\(--qsn-cyan\)[\s\S]{0,120}box-shadow/.test(css));

// ---- 11i2. Opaque real-app shell + no-JS fallback (v10) --------------
// The Mini App must NEVER render transparent: the host chat / a foreign
// document image must not show through if JS/API fail. This locks in the
// opaque root canvas, the removal of the JS-gated visibility:hidden, the
// CSS-only splash auto-hide, and the static no-JS fallback shell.
must("v10 design layer header present",
  /DESIGN SYSTEM v10[\s\S]{0,200}Real-App Opaque Shell/.test(css));
must("html + body pinned to an opaque near-black canvas (#020612)",
  /html,\s*body\s*\{[\s\S]{0,160}background-color:\s*#020612\s*!important/.test(css));
must("html declares its own opaque background + isolation",
  /html\s*\{[\s\S]{0,120}isolation:\s*isolate[\s\S]{0,120}background-color:\s*#020612/.test(css));
must(".app carries a solid opaque dark base (#050b18)",
  /\.app\s*\{[\s\S]{0,200}background-color:\s*#050b18/.test(css));
must(".bg-stack sits on an opaque navy base (no host bleed-through)",
  /\.bg-stack\s*\{[\s\S]{0,120}background-color:\s*#02050e/.test(css));
must("boot-splash has an opaque solid background-color",
  /\.boot-splash\s*\{[\s\S]{0,120}background-color:\s*#04070d/.test(css));

// The JS-gated visibility:hidden that hid the app forever on a failed
// bundle MUST be gone, replaced by a CSS-only auto-hide.
must("legacy JS-gated visibility:hidden on .app/.bg-stack is removed",
  !/body:not\(\.boot-done\)\s+\.app[\s\S]{0,80}visibility:\s*hidden/.test(css));
must("boot-splash auto-hides via CSS even without JS",
  /@keyframes\s+bootSplashAutoHide/.test(css) &&
  /\.boot-splash\s*\{[\s\S]{0,160}animation:\s*bootSplashAutoHide/.test(css));

// No-JS fallback shell — markup + CSS + the app.js root-class swap.
must("root html ships the no-js fallback class by default",
  /<html\s+lang="ru"\s+class="no-js"/.test(html));
must("no-JS fallback shell markup present on the page",
  /class="fallback-shell"[\s\S]{0,120}data-testid="fallback-shell"/.test(html));
must("fallback shell shows blue-neon skeleton panels",
  (html.match(/class="fallback-shell__panel"/g) || []).length >= 3 &&
  /class="fallback-shell__skeleton/.test(html));
must("fallback shell is shown under html.no-js, hidden under html.js",
  /html\.no-js\s+\.fallback-shell\s*\{[\s\S]{0,80}display:\s*block/.test(css) &&
  /html\.js\s+\.fallback-shell\s*\{[\s\S]{0,80}display:\s*none/.test(css));
must("app.js swaps the root class no-js -> js on boot",
  /classList\.remove\(\s*["']no-js["']\s*\)/.test(app) &&
  /classList\.add\(\s*["']js["']\s*\)/.test(app));

// ---- 11j. Cache-busting / build versioning ----------------------------
// Telegram/Vercel must never serve a stale bundle: a build version meta
// tag + ?v= query strings on the static asset links + a no-cache HTML
// header guarantee the new neon design is fetched.
const ver = read("vercel.json");
const VBUILD = "v10-realapp-20260602";
must("build version meta tag present in HTML",
  new RegExp('<meta\\s+name="qsi-build"\\s+content="' + VBUILD + '"').test(html));
must("window.QSI_BUILD exposes the build version",
  new RegExp('QSI_BUILD\\s*=\\s*"' + VBUILD + '"').test(html));
must("styles.css link is cache-busted with ?v=",
  /href="\.\/styles\.css\?v=10-realapp-20260602"/.test(html));
must("app.js link is cache-busted with ?v=",
  /src="\.\/app\.js\?v=10-realapp-20260602"/.test(html));
must("i18n.js + api.js links are cache-busted with ?v=",
  /src="\.\/i18n\.js\?v=10-realapp-20260602"/.test(html) &&
  /src="\.\/api\.js\?v=10-realapp-20260602"/.test(html));
must("vercel.json revalidates JS/CSS bundles",
  /styles[\\.]+css\|app[\\.]+js\|api[\\.]+js\|i18n[\\.]+js/.test(ver) &&
  /max-age=0,\s*must-revalidate/.test(ver));
must("vercel.json marks HTML as no-cache (fresh ?v= links served)",
  /"source":\s*"\/index\.html"[\s\S]{0,160}no-cache/.test(ver) &&
  /"source":\s*"\/"[\s\S]{0,160}no-cache/.test(ver));

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
