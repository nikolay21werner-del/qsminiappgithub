#!/usr/bin/env node
/* verify-stability.mjs
 *
 * Locks in the QUANTSIGNAL AI Mini App "no screen jump on tap"
 * stability rules. The goal is mechanical: a future change must not
 * silently reintroduce a layout shift on tab switches or button taps.
 *
 * Checks fall into three buckets:
 *   1. Layout-stability CSS (touch-action, tap-highlight, no active
 *      transforms that translate layout, stable screen min-height).
 *   2. App.js behavior (no smooth-scroll-to-top on every setScreen,
 *      delegated click handling, single-pass class toggling).
 *   3. Professional polish (>=44px tap targets, safe-area padding,
 *      reduced-motion media query, stable topbar/tabbar dimensions).
 *
 * Exits non-zero on any failure. Mirrors verify-tap-stability /
 * verify-banners so the CI failure surface looks the same.
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

const css = read("styles.css");
const app = read("app.js");
const html = read("index.html");
const pkg = JSON.parse(read("package.json"));

// ---- 1. Layout stability — CSS rules ------------------------------------
must("tap-highlight-color transparent on app shell",
  /-webkit-tap-highlight-color:\s*transparent/.test(css));
must("touch-action: manipulation on interactive surfaces",
  /touch-action:\s*manipulation/.test(css));
must("overflow-anchor disabled on scroll containers",
  /overflow-anchor:\s*none/.test(css));
must(":active transform is neutralised (no layout-shifting press feedback)",
  /:active[\s\S]{0,200}transform:\s*none/.test(css));
must("user-select disabled on interactive surfaces",
  /user-select:\s*none/.test(css));

// Stable screen sizing — both .screen and .screens reserve enough vertical
// space so tab switches do not collapse/expand the page height.
must(".screens reserves min-height via 100dvh/100vh",
  /\.screens\s*\{[\s\S]*?min-height:[^;]*100(?:dvh|vh)/.test(css));
must(".screen reserves min-height via 100dvh/100vh",
  /\.screen\s*\{[\s\S]*?min-height:[^;]*100(?:dvh|vh)/.test(css));

// Tap target safety net (Apple HIG / Material) — >=44px on every
// touch-interactive thing.
must("--tap-min defined at >=44px",
  /--tap-min:\s*4[4-9]px/.test(css));
must("bottom tab min-height >=44px (>=48px in our rules)",
  /\.tabbar\s+\.tab[\s\S]*?min-height:\s*[4-9][0-9]px/.test(css));

// Stable topbar — pinned height + reserved label aspect-ratio so the
// logo decode cannot collapse the bar.
must("topbar declares a stable min-height",
  /\.topbar\s*\{[\s\S]*?min-height:\s*[3-9][0-9]px/.test(css));
must("topbar label declares a fixed aspect-ratio",
  /\.topbar__label[\s\S]*?aspect-ratio:/.test(css));

// Safe-area padding for the iOS / Telegram WebView notch and home
// indicator. We already pad bottom; assert it stays.
must("safe-area-inset-bottom is used on the app shell",
  /env\(safe-area-inset-bottom\)/.test(css));
must("safe-area-inset-top is used on the app shell",
  /env\(safe-area-inset-top\)/.test(css));

// Reduced motion safety net.
must("prefers-reduced-motion media query disables animations",
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css) &&
  /animation-duration:\s*0\.001ms/.test(css));

// Loading placeholders / skeletons reserve room so async fills don't
// push the page down.
must("live render containers reserve min-height",
  /#matrix[\s\S]{0,200}min-height/.test(css) ||
  /#signals-list[\s\S]{0,200}min-height/.test(css));

// ---- 1b. Viewport fit — Mini App must not drift off-screen ---------------
// html/body must block horizontal overflow so the shell can't be pushed
// sideways by an oversize descendant.
must("html, body have overflow-x: hidden",
  /html,\s*body\s*\{[\s\S]*?overflow-x:\s*hidden/.test(css));
// --app-height custom property is declared as a fallback at :root.
must("--app-height custom property is declared",
  /--app-height:/.test(css));
// .app must consult --app-height (with 100dvh/100vh fallbacks) for height.
must(".app min-height uses var(--app-height)",
  /\.app\s*\{[\s\S]*?min-height:[^;]*var\(--app-height/.test(css));
// .app width is capped to the viewport so it can never exceed the screen.
must(".app max-width is capped to viewport (min(460px, 100%))",
  /\.app\s*\{[\s\S]*?max-width:\s*min\(\s*460px,\s*100%\s*\)/.test(css));
// .app blocks horizontal overflow internally.
must(".app declares overflow-x: hidden",
  /\.app\s*\{[\s\S]*?overflow-x:\s*hidden/.test(css));
// Tabbar is capped at the viewport too.
must(".tabbar max-width is capped to viewport",
  /\.tabbar\s*\{[\s\S]*?max-width:\s*min\(\s*460px,\s*100%\s*\)/.test(css));
// Internal scroll containment so rubber-band scrolling cannot push the
// whole Mini App off-screen.
must("app/screens declare overscroll-behavior: contain",
  /\.app,\s*\.screens\s*\{[\s\S]*?overscroll-behavior:\s*contain/.test(css));
// Defensive min-width: 0 on matrix/partner/card so long inline content
// (prices, titles) can shrink instead of widening the parent.
must("matrix/partner/card declare min-width: 0",
  /\.matrix,[\s\S]*?\.matrix-cell,[\s\S]*?\.partner-card,[\s\S]*?min-width:\s*0/.test(css));
// Topbar label stays inside its 58vw / 220px cap (already enforced;
// re-asserted so a future edit cannot remove it).
must("topbar label max-width is clamped to 58vw / 220px",
  /\.topbar__label\s*\{[\s\S]*?max-width:\s*min\(\s*58vw,\s*220px\s*\)/.test(css));

// JS must set --app-height from Telegram.WebApp + visualViewport.
must("app.js reads Telegram viewportStableHeight",
  /viewportStableHeight/.test(app));
must("app.js falls back to visualViewport.height",
  /visualViewport\s*&&\s*window\.visualViewport\.height|window\.visualViewport\.height/.test(app));
must("app.js writes --app-height onto documentElement",
  /setProperty\(\s*["']--app-height["']/.test(app));
must("app.js binds viewport listeners (resize/orientationchange/visualViewport)",
  /addEventListener\(\s*["']resize["'][\s\S]*?applyAppHeight/.test(app) &&
  /addEventListener\(\s*["']orientationchange["']/.test(app));
must("app.js subscribes to Telegram viewportChanged",
  /tg\.onEvent[\s\S]{0,80}["']viewportChanged["']|onEvent\(\s*["']viewportChanged["']/.test(app));

// ---- 1b2. Opaque shell — never render transparent (v10) ------------------
// The Mini App must always paint an opaque dark surface so the Telegram
// host chat / a foreign background can never show through if JS or the
// API fail to load. This is the stability guard for the "приложение
// прозрачное / посторонняя картинка" regression.
must("html + body have an opaque near-black background-color",
  /html,\s*body\s*\{[\s\S]{0,200}background-color:\s*#020612/.test(css));
must(".app paints a solid opaque dark base",
  /\.app\s*\{[\s\S]{0,200}background-color:\s*#050b18/.test(css));
must("no JS-gated visibility:hidden hides the app on a failed bundle",
  !/body:not\(\.boot-done\)\s+\.app[\s\S]{0,80}visibility:\s*hidden/.test(css));
must("boot-splash auto-dismisses via CSS (no permanent overlay if JS dies)",
  /@keyframes\s+bootSplashAutoHide/.test(css));
must("static no-JS fallback shell exists in markup",
  /class="fallback-shell"/.test(html) &&
  /<html\s+lang="ru"\s+class="no-js"/.test(html));
must("app.js swaps root no-js -> js so fallback hides only when JS lives",
  /classList\.remove\(\s*["']no-js["']\s*\)/.test(app) &&
  /classList\.add\(\s*["']js["']\s*\)/.test(app));

// ---- 1b3. Bottom-nav overlap guard (v11) --------------------------------
// The fixed bottom dock must NEVER overlap the final visible panel. Every
// scrollable surface reserves clearance from a single nav-height variable
// + safe-area + a gap, with matching scroll-padding for anchored scrolls.
// Stability guard for the "AI Signal hidden behind the nav" regression.
must("v11 real-app fix layer present",
  /DESIGN SYSTEM v11[\s\S]{0,160}Real-App Fix/.test(css));
must("stable --bottom-nav-height variable defined",
  /--bottom-nav-height:\s*\d+px/.test(css));
must(".app reserves bottom-nav clearance (nav height + safe-area + gap)",
  /\.app\s*\{[\s\S]{0,200}padding-bottom:\s*calc\(\s*var\(--bottom-nav-height\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\+\s*28px/.test(css));
must(".app sets scroll-padding-bottom so anchored scrolls clear the nav",
  /\.app\s*\{[\s\S]{0,400}scroll-padding-bottom:\s*calc\(\s*var\(--bottom-nav-height\)/.test(css));
must("v11 cache marker bumped (no stale CSS/JS served)",
  /content="v11-realapp-fix-20260613"/.test(html) &&
  /\?v=11-realapp-fix-20260613/.test(html));

// ---- 1c. Keyboard-aware viewport mode -----------------------------------
// When an editable element is focused and the visualViewport shrinks
// (soft keyboard up), the app must:
//   - toggle a `keyboard-open` class on body (so CSS can react),
//   - prefer the smaller LIVE viewport over stableHeight,
//   - hide / reposition the bottom tabbar so it doesn't overlap the
//     keyboard or trap nav icons between composer and keyboard,
//   - keep the AI composer visible above the keyboard,
//   - nudge the focused composer into view (no smooth scroll-to-top).
must("app.js detects keyboard-open state via focus + viewport delta",
  /detectKeyboardOpen[\s\S]{0,800}delta\s*>\s*1[0-9][0-9]/.test(app));
must("app.js toggles `keyboard-open` class on body",
  /classList\.add\(\s*["']keyboard-open["']\s*\)/.test(app) &&
  /classList\.remove\(\s*["']keyboard-open["']\s*\)/.test(app));
must("app.js prefers LIVE (smaller) height when keyboard is open",
  /readLiveHeight\s*\([\s\S]*?\)/.test(app) &&
  /kb\s*\?\s*readLiveHeight\(\)\s*:\s*readStableHeight\(\)/.test(app));
must("app.js identifies editable focus targets (input/textarea/contenteditable)",
  /isEditableTarget[\s\S]{0,400}INPUT[\s\S]{0,200}TEXTAREA[\s\S]{0,200}isContentEditable/.test(app));
must("app.js listens to focusin/focusout to re-apply --app-height",
  /addEventListener\(\s*["']focusin["']/.test(app) &&
  /addEventListener\(\s*["']focusout["']/.test(app));
must("app.js does NOT unconditionally scroll to top on focus",
  !/focusin[\s\S]{0,200}window\.scrollTo\(\s*0\s*,\s*0\s*\)/.test(app) &&
  !/focusin[\s\S]{0,200}scrollTo\(\{\s*top:\s*0/.test(app));

// CSS — keyboard-open state contract
must("CSS scopes a body.keyboard-open variant",
  /body\.keyboard-open\b/.test(css));
must("CSS hides the bottom tabbar while keyboard is open",
  /body\.keyboard-open\s+\.tabbar\s*\{[\s\S]*?(opacity:\s*0|display:\s*none|transform:\s*translate)/.test(css));
must("CSS repositions the AI composer above the keyboard while typing",
  /body\.keyboard-open\s+\.ai-compose\s*\{[\s\S]*?bottom:/.test(css));
must("CSS sets scroll-padding-bottom on AI screen when keyboard open",
  /body\.keyboard-open\s+\.screen--ai\s*\{[\s\S]*?scroll-padding-bottom:/.test(css));
must("CSS reduces .app bottom padding when keyboard is open",
  /body\.keyboard-open\s+\.app\s*\{[\s\S]*?padding-bottom:/.test(css));

// ---- 2. App.js behavior --------------------------------------------------
must("setScreen does NOT unconditionally smooth-scroll to top",
  !/setScreen[\s\S]{0,400}window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*["']smooth["']\s*\}\)\s*;\s*if/m.test(app) ||
  /var\s+same\s*=\s*state\.screen\s*===\s*name/.test(app),
  "setScreen() must only scroll to top when re-tapping the active tab");
must("setScreen tracks 'same screen re-tap' for intentional scroll-to-top",
  /var\s+same\s*=\s*state\.screen\s*===\s*name/.test(app));
must("setScreen toggles screen + tab classes in a single pass each",
  /\$\$\(\s*['"]\.screen['"]\s*\)\.forEach/.test(app) &&
  /\$\$\(\s*['"]\.tab['"]\s*\)\.forEach/.test(app));
must("click handling is delegated on document",
  /document\.addEventListener\(\s*["']click["']/.test(app));

// ---- 3. UI integrity guarantees ------------------------------------------
must("topnav (top section nav) is NOT present",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
must("bottom tabbar is present with 5 data-nav targets",
  /<nav\s+class="tabbar"/.test(html) &&
  /data-nav="overview"/.test(html) &&
  /data-nav="signals"/.test(html) &&
  /data-nav="market"/.test(html) &&
  /data-nav="ai"/.test(html) &&
  /data-nav="profile"/.test(html));
must("Antarctic partner card still present",
  /id="partner-antarctic"/.test(html));
must("removed Overview blocks stay absent (balance hero / ticker / action bar / top coins)",
  !/class="balance-hero"/.test(html) &&
  !/class="ticker"/.test(html) &&
  !/class="action-bar"/.test(html) &&
  !/class="card market-top"/.test(html) &&
  !/id="overview-rows"/.test(html));
must("no Crypto Combat / tap game markup",
  !/id="combat-cta-card"/.test(html) &&
  !/QSI_COMBAT/.test(app) &&
  !/\/api\/combat\b/.test(app));

// Topbar label image must reserve dimensions (width/height attributes)
// so no layout shift while it decodes.
must("topbar label image declares width + height attributes",
  /class="topbar__label"[\s\S]{0,300}width="\d+"\s+height="\d+"/.test(html));
must("boot-splash label image declares width + height attributes",
  /class="boot-splash__label"[\s\S]{0,400}width="\d+"\s+height="\d+"/.test(html));

// ---- 3b. Native app shell (v6) stability contract ------------------------
// The pinned native header and tight card-stack feed must not reintroduce
// layout shift or horizontal drift on phones.
must("v6 sticky header still honours safe-area-inset-top",
  /\.topbar\s*\{[\s\S]{0,400}env\(safe-area-inset-top\)/.test(css));
must("v6 sticky header keeps a stable min-height (no collapse on scroll)",
  /\.topbar\s*\{[\s\S]{0,260}min-height:\s*var\(--qsi-header-h\)/.test(css) &&
  /--qsi-header-h:\s*5[0-9]px/.test(css));
must("v6 tab bar keeps a >=44px tab tap target (min-height 50px)",
  /\.tabbar\s+\.tab\s*\{[\s\S]{0,200}min-height:\s*50px/.test(css));
must("v6 native section labels reserve height (no async jump)",
  /\.stack-label\s*\{[\s\S]{0,260}min-height:\s*1[0-9]px/.test(css));
must("v6 overview grids declare min-width:0 (no horizontal overflow)",
  /\.kpi-strip,[\s\S]{0,160}min-width:\s*0/.test(css));
must("v6 keyboard-open contract still pins header + hides tabbar",
  /body\.keyboard-open\s+\.topbar\s*\{/.test(css) &&
  /body\.keyboard-open\s+\.tabbar\s*\{[\s\S]*?(opacity:\s*0|translate)/.test(css));
must("v6 stack-label press feedback is filter-only (no layout shift)",
  /\.stack-label:active\s*\{[\s\S]{0,80}filter:/.test(css) &&
  !/\.stack-label:active\s*\{[\s\S]{0,80}(margin|width|height|padding)\s*:/.test(css));

// ---- 4. package.json verify script entry ---------------------------------
must("npm run verify:stability is registered",
  pkg.scripts && pkg.scripts["verify:stability"] === "node scripts/verify-stability.mjs");

// ---- 5. JS parse check ---------------------------------------------------
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
  console.error("\nverify-stability: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-stability OK");
