#!/usr/bin/env node
/* verify-design.mjs
   Static smoke test for the QUANTSIGNAL AI premium-design pass.
   Asserts:
     - Design v2 layer present in styles.css (tokens, glass, shadows)
     - Crypto Combat v2 visual hooks present (cta stats, arena, tap, packs)
     - Topnav stays removed; bottom .tabbar intact and same 5 tabs
     - Overview combat CTA present with QP + Level stat surfaces
     - Reduced-motion @media block still respected for combat
     - Touch-target safety net hooked for primary buttons
     - No leftover .topnav rules
   Exits non-zero on any failure.
*/

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
const css  = read("styles.css");
const app  = read("app.js");

// --- 1. Design v2 marker -----------------------------------------------
must("design-v2 layer marker present",
  /DESIGN SYSTEM v2/i.test(css),
  "styles.css must include the v2 design system block");

// --- 2. New design tokens / variables ----------------------------------
for (const v of [
  "--accent-1", "--accent-2", "--accent-3",
  "--glass-1", "--glass-2",
  "--surface-1", "--surface-2",
  "--border-soft", "--border-strong",
  "--shadow-card", "--shadow-cta",
  "--tap-min"
]) {
  must(`CSS token ${v} defined`,
    new RegExp(v.replace(/[-]/g, "\\-") + "\\s*:").test(css),
    `missing token ${v}`);
}

// --- 3. Glass / surface usage on key components ------------------------
must("tabbar uses backdrop-filter blur",
  /\.tabbar[\s\S]{0,400}backdrop-filter:\s*blur/.test(css));
must("topbar uses backdrop-filter blur",
  /\.topbar[\s\S]{0,400}backdrop-filter:\s*blur/.test(css));
must("combat-arena uses shadow-card",
  /\.combat-arena[\s\S]{0,400}var\(--shadow-card\)/.test(css));
must("hero-card uses richer radial background",
  /\.hero-card[\s\S]{0,400}radial-gradient/.test(css));

// --- 4. Crypto Combat v2 visuals ---------------------------------------
must("CSS upgrades combat-tap (≥168px)",
  /\.combat-tap\s*\{[\s\S]*?width:\s*(168|176|180|184|192|200)px/.test(css));
must("CSS upgrades combat-bar height (≥10px)",
  /\.combat-bar\s*\{[\s\S]*?height:\s*(10|11|12)px/.test(css));
must("CSS gives boss bar a glow",
  /\.combat-bar--boss[\s\S]{0,200}box-shadow/.test(css));
must("CSS gives player bar a glow",
  /\.combat-bar--player[\s\S]{0,200}box-shadow/.test(css));
must("CSS gives combat-tap a multi-layer shadow",
  /\.combat-tap\s*\{[\s\S]*?box-shadow:[\s\S]*?(\d+px[^;]+,[\s\S]*?\d+px)/.test(css));
must("combat-pack premium border-radius",
  /\.combat-pack\s*\{[\s\S]*?border-radius:\s*1[46]px/.test(css));
must("combat-pack data-pack=\"energy\" themed",
  /\.combat-pack\[data-pack="energy"\]/.test(css));
must("combat-pack data-pack=\"damage\" themed",
  /\.combat-pack\[data-pack="damage"\]/.test(css));
must("combat-pack data-pack=\"revive\" themed",
  /\.combat-pack\[data-pack="revive"\]/.test(css));
must("combat-board__self pill styled",
  /\.combat-board__self[\s\S]{0,200}border-radius/.test(css));
must("combat-status pill style",
  /\.combat-status\s*\{[\s\S]*?border-radius/.test(css));

// --- 5. Overview CTA new structure -------------------------------------
must("Overview CTA stats wrapper",
  /class="combat-cta__stats"/.test(html));
must("Overview CTA QP stat",
  /combat-cta__stat--qp[\s\S]{0,300}id="combat-cta-balance"/.test(html));
must("Overview CTA Level stat",
  /combat-cta__stat--lvl[\s\S]{0,300}id="combat-cta-level"/.test(html));
must("CTA card retains test hooks",
  /id="combat-cta-card"/.test(html) &&
  /data-testid="combat-cta-card"/.test(html) &&
  /data-action="open-combat"/.test(html) &&
  /data-testid="combat-cta-button"/.test(html));

// --- 6. app.js writes the new CTA level surface ------------------------
must("app.js updates #combat-cta-level on state",
  /setText\(\s*["']#combat-cta-level["']/.test(app));
must("app.js still updates #combat-cta-balance",
  /setText\(\s*["']#combat-cta-balance["']/.test(app));

// --- 7. Topnav removed; bottom tabbar intact ---------------------------
must("topnav class absent in HTML",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
must("no leftover .topnav CSS rules",
  !/\.topnav(?:__tab)?\s*\{/.test(css));
const tabbar = html.match(/<nav[^>]*class="tabbar"[\s\S]*?<\/nav>/);
must("bottom .tabbar present", !!tabbar);
const tabbarHtml = tabbar ? tabbar[0] : "";
must("no combat/tap/game item in bottom nav",
  !/data-nav="combat"/.test(tabbarHtml) &&
  !/data-nav="tap"/.test(tabbarHtml) &&
  !/data-nav="game"/.test(tabbarHtml));
const tabCount = (tabbarHtml.match(/data-nav="[a-z]+"/g) || []).length;
must("bottom nav has 5 tabs (overview/signals/market/ai/profile)",
  tabCount === 5, `found ${tabCount}`);

// --- 8. Reduced-motion guard for combat --------------------------------
must("reduced-motion @media disables combat decorative animations",
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.combat-tap__pulse/.test(css));

// --- 9. Touch-target safety net ----------------------------------------
must("touch-target safety net applied to primary buttons",
  /\.tab,\s*\.cta,\s*\.chip[\s\S]{0,400}min-height:\s*var\(--tap-min\)/.test(css));

// --- 10. Stable tap target — combat module must NOT reassign arena ----
const combatBlock = (() => {
  const m = /var\s+combat\s*=\s*\(function[\s\S]+?\}\)\(\);/m.exec(app);
  return m ? m[0] : "";
})();
must("combat module never reassigns arena/tap/body innerHTML",
  !/(combat-arena|combat-tap|combat-body)[^=]*\.innerHTML\s*=/.test(combatBlock));

console.log("\nverify-design OK");
