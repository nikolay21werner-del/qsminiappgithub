#!/usr/bin/env node
/* verify-telegram-branding.mjs
 *
 * Locks in the QUANTSIGNAL AI Telegram bot + channel branding scaffold:
 *
 * - Webhook endpoint api/telegram/bot-webhook.js exists, parses, exports
 *   a handler, and:
 *     - reads TELEGRAM_BOT_TOKEN / BOT_TOKEN from env (never hardcoded),
 *     - honours QSI_BOT_WEBHOOK_SECRET when present,
 *     - replies with HTML caption + inline keyboard containing a
 *       web_app button to the Mini App and a URL button to the channel,
 *     - includes RU welcome copy.
 * - Brand assets exist under assets/telegram/.
 * - TELEGRAM_BRANDING_SETUP.md exists and documents the BotFather-only
 *   bot avatar limitation, webhook setup, channel setup.
 * - package.json registers verify:telegram-branding.
 * - vercel.json registers the new function.
 * - Surrounding shell is unchanged (no game/combat, partner ad intact,
 *   bottom nav unchanged, channel post footer still links to the bot).
 * - All key JS files parse with node --check.
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

const endpointPath = "api/telegram/bot-webhook.js";
must("webhook endpoint exists at " + endpointPath,
  existsSync(join(root, endpointPath)));

const endpoint = read(endpointPath);
const setup    = existsSync(join(root, "TELEGRAM_BRANDING_SETUP.md"))
  ? read("TELEGRAM_BRANDING_SETUP.md") : "";
const channel  = read("api/channel/post.js");
const html     = read("index.html");
const app      = read("app.js");
const pkg      = JSON.parse(read("package.json"));
const vercel   = JSON.parse(read("vercel.json"));

// ---- 1. Endpoint shape --------------------------------------------------
must("endpoint exports a handler",
  /module\.exports\s*=\s*async function/.test(endpoint));
must("endpoint reads TELEGRAM_BOT_TOKEN or BOT_TOKEN from env",
  /process\.env\.TELEGRAM_BOT_TOKEN/.test(endpoint) &&
  /process\.env\.BOT_TOKEN/.test(endpoint));
must("endpoint honours QSI_BOT_WEBHOOK_SECRET when configured",
  /QSI_BOT_WEBHOOK_SECRET/.test(endpoint) &&
  /x-telegram-bot-api-secret-token/i.test(endpoint));
must("endpoint calls Telegram Bot API",
  /api\.telegram\.org/.test(endpoint) && /\/bot/.test(endpoint));
must("endpoint uses sendPhoto and sendMessage (with fallback)",
  /sendPhoto/.test(endpoint) && /sendMessage/.test(endpoint));
must("endpoint sets parse_mode HTML",
  /parse_mode/.test(endpoint) && /HTML/.test(endpoint));
must("endpoint escapes user-controlled strings (escapeHtml)",
  /escapeHtml\s*\(/.test(endpoint));
must("endpoint recognises /start, /app, /help triggers",
  /\/start/.test(endpoint) && /\/app/.test(endpoint) && /\/help/.test(endpoint));
must("endpoint ignores non-private chats",
  /private/.test(endpoint));
must("endpoint returns 200 for non-trigger updates (no spam)",
  /handled:\s*false/.test(endpoint));

// Inline keyboard with Mini App web_app button + channel URL button.
must("inline keyboard contains web_app button to Mini App URL",
  /web_app\s*:\s*\{\s*url\s*:\s*MINI_APP_URL\s*\}/.test(endpoint) &&
  /MINI_APP_URL\s*=\s*"https:\/\/quantsignal-miniapp\.vercel\.app\/?"/.test(endpoint));
must("inline keyboard contains channel URL button (t.me/QUANTSIGNAL_AI)",
  /t\.me\/QUANTSIGNAL_AI(?!_BOT)/.test(endpoint));
must("welcome button label in Russian for Mini App",
  /Открыть QUANTSIGNAL AI/.test(endpoint));
must("welcome button label in Russian for channel",
  /Канал QUANTSIGNAL AI/.test(endpoint));

// RU welcome caption content.
must("welcome caption mentions QUANTSIGNAL AI brand",
  /QUANTSIGNAL AI/.test(endpoint));
must("welcome caption mentions живой рынок / AI / сигналы",
  /Живой рынок/i.test(endpoint) &&
  /AI[- ]аналитика/i.test(endpoint) &&
  /Сигналы/i.test(endpoint));
must("welcome caption includes risk disclaimer",
  /Не финансовая рекомендация/.test(endpoint));
must("welcome caption mentions the channel @QUANTSIGNAL_AI",
  /@QUANTSIGNAL_AI(?!_BOT)/.test(endpoint));

// ---- 2. No hard-coded secrets -------------------------------------------
must("no hard-coded Telegram bot token literal",
  !/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(endpoint));
must("no Authorization: Bearer <literal> in source",
  !/Bearer\s+[A-Za-z0-9_-]{20,}/.test(endpoint));

// ---- 3. Brand assets ----------------------------------------------------
must("avatar asset exists (assets/telegram/avatar.svg)",
  existsSync(join(root, "assets/telegram/avatar.svg")));
must("welcome banner asset exists (assets/telegram/welcome-banner.svg)",
  existsSync(join(root, "assets/telegram/welcome-banner.svg")));
must("channel banner asset exists (assets/telegram/channel-banner.svg)",
  existsSync(join(root, "assets/telegram/channel-banner.svg")));
must("avatar PNG asset exists (assets/telegram/avatar.png)",
  existsSync(join(root, "assets/telegram/avatar.png")));
must("welcome banner PNG asset exists (assets/telegram/welcome-banner.png)",
  existsSync(join(root, "assets/telegram/welcome-banner.png")));
must("channel banner PNG asset exists (assets/telegram/channel-banner.png)",
  existsSync(join(root, "assets/telegram/channel-banner.png")));

const avatar = read("assets/telegram/avatar.svg");
const welcome = read("assets/telegram/welcome-banner.svg");
must("avatar is square 512x512 SVG",
  /viewBox="0 0 512 512"/.test(avatar) && /<svg /.test(avatar));
must("welcome banner is 1280x720 SVG",
  /viewBox="0 0 1280 720"/.test(welcome) && /<svg /.test(welcome));
must("welcome banner contains Russian wording",
  /Премиум|премиум|Добро пожаловать|Сигналы|AI-аналитика/.test(welcome));
must("endpoint references the welcome banner PNG asset path",
  /\/assets\/telegram\/welcome-banner\.png/.test(endpoint));
must("endpoint does NOT reference the SVG welcome banner for sendPhoto",
  !/WELCOME_BANNER_PATH\s*=\s*"\/assets\/telegram\/welcome-banner\.svg"/.test(endpoint));

// ---- 4. Setup doc -------------------------------------------------------
must("TELEGRAM_BRANDING_SETUP.md exists", setup.length > 0);
must("setup doc notes BotFather-only limitation for bot avatar",
  /BotFather/.test(setup) && /(аватар|Botpic)/i.test(setup));
must("setup doc documents setWebhook with secret_token",
  /setWebhook/.test(setup) && /secret_token/.test(setup));
must("setup doc references the webhook path",
  /\/api\/telegram\/bot-webhook/.test(setup));
must("setup doc covers channel avatar + description + pin",
  /@QUANTSIGNAL_AI/.test(setup) &&
  /(закрепл|Pin)/i.test(setup) &&
  /(аватар|setChatPhoto)/i.test(setup));
must("setup doc is in Russian (basic heuristic)",
  /[А-Яа-яЁё]/.test(setup));

// ---- 5. package.json ----------------------------------------------------
must("npm run verify:telegram-branding exists",
  pkg.scripts && pkg.scripts["verify:telegram-branding"] ===
    "node scripts/verify-telegram-branding.mjs");

// ---- 6. vercel.json -----------------------------------------------------
must("vercel.json registers api/telegram/bot-webhook.js function",
  vercel.functions && "api/telegram/bot-webhook.js" in vercel.functions);

// ---- 7. Surrounding shell still intact ----------------------------------
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
must("channel post caption footer still links to QUANTSIGNAL AI bot",
  /<a href="https:\/\/t\.me\/QUANTSIGNAL_AI_BOT">Сигналы QUANTSIGNAL AI<\/a>/
    .test(channel));

// ---- 8. JS parse check --------------------------------------------------
const toCheck = [
  "app.js", "i18n.js", "api.js",
  "api/ai/chat.js", "api/bybit/[endpoint].js",
  "api/_lib/http.js", "api/channel/post.js",
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
    console.error("  FAIL parses " + rel + "  — " +
      (e.stderr ? e.stderr.toString().trim() : e.message));
  }
}

if (failed) {
  console.error("\nverify-telegram-branding: " + failed + " failure(s)");
  process.exit(1);
}
console.log("\nverify-telegram-branding OK");
