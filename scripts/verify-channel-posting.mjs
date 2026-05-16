#!/usr/bin/env node
/* verify-channel-posting.mjs
 *
 * Locks in the QUANTSIGNAL AI Telegram-channel autopost infrastructure:
 * - endpoint exists and parses,
 * - posting is disabled by default,
 * - real publishing is gated by QSI_CHANNEL_POSTING_ENABLED + bot token + chat id,
 * - Telegram delivery uses the Bot API,
 * - caption + branded image are generated,
 * - no Vercel cron is declared (Hobby plan limits crons to daily), and the
 *   setup doc explains how to drive 3/day posting via an external scheduler,
 * - no game/combat hooks reappear,
 * - Antarctic partner ad card is still present,
 * - market/AI routes are still wired,
 * - bot token is NEVER hard-coded.
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

const endpointPath = "api/channel/post.js";
must("endpoint file exists at " + endpointPath, existsSync(join(root, endpointPath)));

const endpoint = read(endpointPath);
const vercel   = JSON.parse(read("vercel.json"));
const pkg      = JSON.parse(read("package.json"));
const html     = read("index.html");
const app      = read("app.js");
const setupDoc = read("CHANNEL_SETUP.md");

// ---- 1. Endpoint code shape ---------------------------------------------
must("endpoint exports a handler",
  /module\.exports\s*=\s*async function/.test(endpoint));
must("posting flag is gated on QSI_CHANNEL_POSTING_ENABLED === \"1\"",
  /QSI_CHANNEL_POSTING_ENABLED[\s\S]*===\s*"1"/.test(endpoint));
must("reads TELEGRAM_BOT_TOKEN (or BOT_TOKEN) env",
  /process\.env\.TELEGRAM_BOT_TOKEN/.test(endpoint) &&
  /process\.env\.BOT_TOKEN/.test(endpoint));
must("reads QSI_TELEGRAM_CHANNEL_ID (or TELEGRAM_CHANNEL_ID) env",
  /process\.env\.QSI_TELEGRAM_CHANNEL_ID/.test(endpoint) &&
  /process\.env\.TELEGRAM_CHANNEL_ID/.test(endpoint));
must("preview mode is forced when env missing",
  /!enabled\s*\|\|\s*!botToken\s*\|\|\s*!chatId/.test(endpoint));
must("calls Telegram Bot API (sendDocument or sendPhoto)",
  /api\.telegram\.org/.test(endpoint) &&
  /\/bot/.test(endpoint) &&
  /(sendPhoto|sendDocument)/.test(endpoint));
must("builds an HTML caption", /parse_mode/.test(endpoint) && /HTML/.test(endpoint));
must("escapes HTML for user-facing strings",
  /escapeHtml\s*\(/.test(endpoint));
must("escapes XML for SVG content",
  /escapeXml\s*\(/.test(endpoint));
must("generates a branded SVG with QUANTSIGNAL AI mark",
  /QUANTSIGNAL AI/.test(endpoint) && /<svg /.test(endpoint));
must("covers BTC, ETH, SOL, TON, DOGE",
  /BTC[\s\S]*ETH[\s\S]*SOL[\s\S]*TON[\s\S]*DOGE/.test(endpoint));

// ---- 1b. New trading-card banner style ----------------------------------
must("hero symbol picker for the trading-card banner",
  /pickHero\s*\(/.test(endpoint));
must("banner renders a 'Бессрочный' perpetual pill",
  /Бессрочный/.test(endpoint));
must("banner includes a timeframe row (1м/5м/15м/1ч/4ч/1д)",
  /"1м"/.test(endpoint) && /"5м"/.test(endpoint) &&
  /"15м"/.test(endpoint) && /"1ч"/.test(endpoint) &&
  /"4ч"/.test(endpoint) && /"1д"/.test(endpoint));
must("5м timeframe is highlighted as active",
  /tfActive\s*=\s*1/.test(endpoint));
must("banner draws programmatic candlesticks",
  /buildCandles\s*\(/.test(endpoint) && /candleSvg\b/.test(endpoint));
must("banner draws a dashed current price line",
  /stroke-dasharray="6 6"/.test(endpoint));
must("banner shows a current price chip on the chart",
  /priceChipW\b/.test(endpoint));
// Layout safety: the price chip must live in a reserved right gutter so it
// can never overlap the candle plot area (validator regression from previous
// pass). The chip x must be derived from plotRightX (chart end), not from
// (chartX + chartW - chipW) which would place it on top of the last candles.
must("chart reserves a right gutter for axis + price chip",
  /rightGutter\b/.test(endpoint) &&
  /plotRightX\s*=\s*chartX\s*\+\s*chartW/.test(endpoint));
must("price chip is anchored past plotRightX (outside candle plot)",
  /priceChipX\s*=\s*plotRightX\s*\+/.test(endpoint));
// Header overlap safety: pair text width drives the perpetual-pill x and
// the pair font shrinks for long tickers (e.g. DOGEUSDT) so they never
// collide with "Бессрочный".
must("perpetual pill x is computed from rendered pair width",
  /pillX\s*=\s*74\s*\+\s*Math\.ceil\(pairWidth\)/.test(endpoint));
must("pair font shrinks for long tickers (DOGEUSDT/etc.)",
  /pairFont\s*=\s*pair\.length\s*>=\s*8/.test(endpoint));
// KPI badge readability: previous pass shipped 12px text on 0.18 fill which
// failed phone-preview QA. Lock in larger text and stronger contrast.
must("KPI badges use >=14px text for readability",
  /font-size="14"[^>]*font-weight="700"[^>]*text-anchor="middle"/.test(endpoint));
must("KPI badge fill-opacity raised for contrast (>=0.30)",
  /fill-opacity="0\.3[4-9]"/.test(endpoint) ||
  /fill-opacity="0\.[4-9]\d*"\s+stroke="' \+ chipColor/.test(endpoint) ||
  /chipColor\s*\+\s*'"\s*fill-opacity="0\.34"/.test(endpoint));
// RSI bar and MACD bars must be tall/wide enough to read on mobile.
must("RSI mini bar is at least 10px tall",
  /rsiBarH\s*=\s*1[0-9]/.test(endpoint));
must("MACD mini bars are at least 8px wide",
  /width="8"\s+height="'\s*\+\s*bh/.test(endpoint));
must("KPI cards present: RSI(14), MACD, Объём 24ч",
  /RSI \(14\)/.test(endpoint) && /MACD/.test(endpoint) && /Объём 24ч/.test(endpoint));
must("RSI status uses ru terms (перекуплен/перепродан/нейтрально)",
  /перекуплен/.test(endpoint) && /перепродан/.test(endpoint) && /нейтрально/.test(endpoint));
must("chart labels '24ч изменение'",
  /24ч изменение/.test(endpoint));
must("banner footer links bot domain t.me/QUANTSIGNAL_AI_BOT",
  /t\.me\/QUANTSIGNAL_AI_BOT/.test(endpoint));
must("old generic 'СВОДКА РЫНКА · RU' SVG header removed",
  !/СВОДКА РЫНКА · RU/.test(endpoint));
must("old mood pill 'Настроение: ' in SVG removed",
  !/Настроение:\s*"\s*\+/.test(endpoint) && !/>Настроение:\s*</.test(endpoint));
must("uses Bybit -> Coinbase -> Kraken market fallback",
  /api\.bybit\.com/.test(endpoint) &&
  /api\.exchange\.coinbase\.com/.test(endpoint) &&
  /api\.kraken\.com/.test(endpoint));
must("uses Russian premium copy",
  /Сводка рынка/.test(endpoint) && /Настроение/.test(endpoint));
must("disclaimer line present",
  /Не финансовая рекомендация/.test(endpoint));
must("caption footer links to QUANTSIGNAL AI bot",
  /<a href="https:\/\/t\.me\/QUANTSIGNAL_AI_BOT">Сигналы QUANTSIGNAL AI<\/a>/.test(endpoint));
must("old in-app footer phrase removed from caption",
  !/Сигналы и идеи — внутри приложения QUANTSIGNAL AI/.test(endpoint));
must("old UTC/MAG timestamp line removed from caption",
  !/escapeHtml\(ts\.utc\)\s*\+\s*"\s*·\s*"\s*\+\s*escapeHtml\(ts\.mag\)/.test(endpoint));
must("preview returns image base64",
  /image_svg_base64/.test(endpoint));
must("endpoint sends the user-provided QUANTSIGNAL AI label via sendPhoto",
  /LABEL_BANNER_RELPATH\s*=\s*"assets\/telegram\/quantsignal-label\.jpeg"/.test(endpoint) &&
  /\/sendPhoto/.test(endpoint));
must("endpoint loads the label image from disk (readLabelBuffer)",
  /readLabelBuffer\s*\(/.test(endpoint) && /fs\.readFileSync/.test(endpoint));
must("preview JSON also exposes the label image (image_base64 + image_path)",
  /image_base64/.test(endpoint) && /image_path/.test(endpoint));
must("authorization check via QSI_CRON_SECRET / CRON_SECRET",
  /QSI_CRON_SECRET/.test(endpoint) && /CRON_SECRET/.test(endpoint));

// ---- 2. No hard-coded secrets -------------------------------------------
// Telegram bot tokens look like "<digits>:<alnum>" of ~46 chars. The
// endpoint must never contain such a literal.
must("no hard-coded Telegram bot token literal",
  !/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(endpoint));
must("no Authorization: Bearer <literal> in source",
  !/Bearer\s+[A-Za-z0-9_-]{20,}/.test(endpoint));

// ---- 3. Vercel config -----------------------------------------------------
must("vercel.json registers api/channel/post.js function",
  vercel.functions && "api/channel/post.js" in vercel.functions);
// Hobby plan only allows daily crons, so the project must NOT declare a
// non-daily Vercel cron. Either no cron block at all, or — if someone adds
// crons back on Pro — none of them should target /api/channel/post with a
// sub-daily schedule. In practice we keep the block removed.
const cronsForChannel = Array.isArray(vercel.crons)
  ? vercel.crons.filter(function (c) { return c && c.path === "/api/channel/post"; })
  : [];
must("vercel.json does NOT declare a Vercel cron for /api/channel/post (Hobby-safe)",
  cronsForChannel.length === 0,
  "remove the crons[] entry for /api/channel/post — Hobby plan only allows daily crons");
must("CHANNEL_SETUP.md documents external scheduler for 3/day posting",
  /внешн(ий|его) шедулер|external scheduler|Perplexity|GitHub Actions|cron-job\.org|Upstash|Cloudflare/i.test(setupDoc) &&
  /Hobby/.test(setupDoc));

// ---- 4. package.json verify script entry ---------------------------------
must("npm run verify:channel-posting exists",
  pkg.scripts && pkg.scripts["verify:channel-posting"] === "node scripts/verify-channel-posting.mjs");

// ---- 5. Surrounding shell still intact -----------------------------------
must("no Crypto Combat / tap game markup reintroduced",
  !/id="combat-cta-card"/.test(html) &&
  !/QSI_COMBAT/.test(app) &&
  !/\/api\/combat\b/.test(app));
must("Antarctic partner card still present",
  /id="partner-antarctic"/.test(html) &&
  /data-testid="partner-antarctic"/.test(html));
must("bottom tabbar still intact (overview/signals/market/ai/profile)",
  /<nav\s+class="tabbar"/.test(html) &&
  /data-nav="overview"/.test(html) &&
  /data-nav="market"/.test(html) &&
  /data-nav="ai"/.test(html));
must("ai/chat endpoint still listed in vercel.json",
  "api/ai/chat.js" in (vercel.functions || {}));
must("bybit endpoint still listed in vercel.json",
  "api/bybit/[endpoint].js" in (vercel.functions || {}));
must("setup doc CHANNEL_SETUP.md exists",
  existsSync(join(root, "CHANNEL_SETUP.md")));

// ---- 6. JS parse check ---------------------------------------------------
const toCheck = [
  "app.js", "i18n.js", "api.js",
  "api/ai/chat.js", "api/bybit/[endpoint].js",
  "api/_lib/http.js", "api/channel/post.js"
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
  console.error("\nverify-channel-posting: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-channel-posting OK");
