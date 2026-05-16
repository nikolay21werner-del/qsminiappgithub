#!/usr/bin/env node
/* verify-partner-ad.mjs
 *
 * Locks in the sponsored Antarctic Wallet partner card: presence, copy,
 * referral link, Telegram open-link fallback, partner label, and the
 * surrounding shell (no game, top nav absent, bottom nav unchanged,
 * market/AI still wired). Pure static checks — no browser required.
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

const html   = read("index.html");
const app    = read("app.js");
const css    = read("styles.css");
const i18n   = read("i18n.js");
const vercel = JSON.parse(read("vercel.json"));

const REF_URL = "https://t.me/antarctic_wallet_bot/app?startapp=ref_7d913f8149";

// ---- 1. HTML: partner card present and wired ---------------------------
must("partner card anchor present",
  /id="partner-antarctic"[\s\S]*data-testid="partner-antarctic"/.test(html));
must("partner card uses anchor element with target=_blank",
  /<a[^>]*class="partner-card"[^>]*target="_blank"/.test(html));
must("partner card has data-action=open-partner-antarctic",
  /data-action="open-partner-antarctic"/.test(html));
must("partner card carries the exact referral URL",
  html.includes('data-partner-url="' + REF_URL + '"')
  && html.includes('href="' + REF_URL + '"'));
must("partner card has rel=noopener noreferrer",
  /class="partner-card"[\s\S]*rel="noopener noreferrer"/.test(html));
must("partner card has sponsored/partner label hook",
  /class="partner-card__label"[^>]*data-i18n="partnerLabel"/.test(html));
must("partner card has title / chip / lede / cta i18n hooks",
  /data-i18n="partnerTitle"/.test(html)
  && /data-i18n="partnerChip"/.test(html)
  && /data-i18n="partnerLede"/.test(html)
  && /data-i18n="partnerCta"/.test(html));
must("partner card lives in Overview (between last-signal and KPIs)",
  (() => {
    const ls = html.indexOf('id="last-signal-card"');
    const pc = html.indexOf('id="partner-antarctic"');
    const kp = html.indexOf('class="kpis"');
    return ls > 0 && pc > ls && kp > pc;
  })(),
  "expected order: last-signal → partner-antarctic → kpis");
must("partner card SVG mark is inline (no external image)",
  /class="partner-card__mark"[\s\S]*?<svg[\s\S]*?<\/svg>/.test(html));
must("RU copy hints present (USDT в сети TON or рублёвому QR)",
  /USDT в сети TON/.test(i18n) && /рублёвому QR/.test(i18n));

// ---- 2. JS: action wired with safe Telegram fallback -------------------
must("openPartnerLink helper exists in app.js",
  /function\s+openPartnerLink\s*\(/.test(app));
must("open-partner-antarctic case in handleAction",
  /case\s+"open-partner-antarctic"/.test(app));
must("partner handler prefers tg.openTelegramLink for t.me URLs",
  /tg\.openTelegramLink\(\s*url\s*\)/.test(app));
must("partner handler falls back to tg.openLink",
  /tg\.openLink\(/.test(app));
must("partner handler falls back to window.open / location.href",
  /window\.open\(\s*url/.test(app) || /window\.location\.href\s*=\s*url/.test(app));
must("anchor-based actions call preventDefault",
  /tagName\s*===\s*"A"[\s\S]{0,200}preventDefault/.test(app));

// ---- 3. CSS: partner card styles present, mobile-friendly --------------
must(".partner-card selector defined",
  /\.partner-card\s*\{/.test(css));
must(".partner-card__cta has min-height >= 44px",
  /\.partner-card__cta[\s\S]*?min-height:\s*44px/.test(css));
must("partner card has gradient blending with app palette",
  /\.partner-card[\s\S]*?linear-gradient/.test(css));
must("partner card honors prefers-reduced-motion",
  /@media\s+\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.partner-card/.test(css));

// ---- 4. i18n: ru/en/zh keys present ------------------------------------
const REQUIRED_KEYS = [
  "partnerLabel", "partnerTitle", "partnerChip", "partnerLede", "partnerCta"
];
for (const k of REQUIRED_KEYS) {
  const count = (i18n.match(new RegExp("\\b" + k + ":\\s*\"", "g")) || []).length;
  must("i18n key '" + k + "' defined for all 3 locales", count >= 3,
    "found " + count + "/3");
}

// ---- 5. Shell guarantees still hold ------------------------------------
must("no Crypto Combat hooks in HTML",
  !/combat-/.test(html) && !/open-combat|close-combat|combat-claim|combat-buy/.test(html));
must("no game/tap/combat nav tabs",
  !/data-nav="combat"/.test(html)
  && !/data-nav="tap"/.test(html)
  && !/data-nav="game"/.test(html));
must("top nav remains absent",
  !/class="topnav"/.test(html) && !/topnav__tab/.test(html));
must("bottom tabbar still has the 5 canonical tabs",
  /<nav\s+class="tabbar"/.test(html)
  && /data-nav="overview"/.test(html)
  && /data-nav="signals"/.test(html)
  && /data-nav="market"/.test(html)
  && /data-nav="ai"/.test(html)
  && /data-nav="profile"/.test(html));
must("ai/chat endpoint still in vercel.json",
  "api/ai/chat.js" in (vercel.functions || {}));
must("bybit endpoint still in vercel.json",
  "api/bybit/[endpoint].js" in (vercel.functions || {}));
must("app.js still wires Bybit market",
  /\/api\/bybit\//.test(app) || /bybit/.test(app));
must("app.js still wires AI chat",
  /\/api\/ai\/chat/.test(app) || /QSI_AI|aiChat|ai-chat/.test(app));
must("no Stars boost or combat endpoints in vercel.json",
  !Object.keys(vercel.functions || {}).some(f =>
    f.startsWith("api/combat/") || f.startsWith("api/stars/") || f.startsWith("api/telegram/")));
must("no resurrected combat module in app.js",
  !/QSI_COMBAT/.test(app) && !/var\s+combat\s*=\s*\(function/.test(app));

// ---- 6. JS parse check -------------------------------------------------
const parseTargets = [
  "app.js", "i18n.js", "api.js",
  "api/ai/chat.js", "api/bybit/[endpoint].js", "api/_lib/http.js"
].filter(p => existsSync(join(root, p)));
for (const p of parseTargets) {
  try {
    execFileSync(process.execPath, ["--check", join(root, p)], { stdio: "pipe" });
    console.log("  ok   parses " + p);
  } catch (e) {
    failed++;
    console.error("  FAIL parses " + p + "  — " + (e.stderr ? e.stderr.toString().trim() : e.message));
  }
}

if (failed) {
  console.error("\nverify-partner-ad: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-partner-ad OK");
