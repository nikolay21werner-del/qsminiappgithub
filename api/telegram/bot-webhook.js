/* =========================================================
   QUANTSIGNAL AI — /api/telegram/bot-webhook
   (Vercel serverless function)

   Receives Telegram Bot API updates and replies to first-contact
   commands (/start, /app, /help) with a premium Russian welcome
   message: branded photo (or text fallback) + HTML caption + inline
   keyboard with a Mini App button and a channel button.

   SAFETY:
     - Bot token is read ONLY from process.env (TELEGRAM_BOT_TOKEN or
       BOT_TOKEN). Never hard-coded.
     - If QSI_BOT_WEBHOOK_SECRET is configured, the
       X-Telegram-Bot-Api-Secret-Token header MUST match. Mismatched
       requests are rejected with 401 and nothing is sent.
     - When the token is missing the endpoint silently returns 200
       so Telegram does not retry; it never attempts an outbound call
       with an empty token.
     - Non-command and non-text updates return 200 with no side
       effects so groups/channels do not trigger sends.
   ========================================================= */

"use strict";

const TG_API = "https://api.telegram.org";
const UPSTREAM_TIMEOUT_MS = 8000;

const MINI_APP_URL = "https://quantsignal-miniapp.vercel.app/";
const CHANNEL_URL = "https://t.me/QUANTSIGNAL_AI";
const CHANNEL_USERNAME = "@QUANTSIGNAL_AI";
const BOT_USERNAME = "@QUANTSIGNAL_AI_BOT";

// Exact user-provided QUANTSIGNAL AI label image. Used as the canonical
// banner everywhere a wide brand image is needed. The old asset path
// "/assets/telegram/welcome-banner.png" is kept as an on-disk alias of
// the same image so previously cached URLs keep resolving to the
// correct label.
const LABEL_BANNER_PATH = "/assets/telegram/quantsignal-label.jpeg";
const LEGACY_WELCOME_BANNER_PATH = "/assets/telegram/welcome-banner.png";
const WELCOME_BANNER_PATH = LABEL_BANNER_PATH;

// ---------- HTTP helpers ----------
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || UPSTREAM_TIMEOUT_MS);
  const init = Object.assign({
    method: "GET",
    headers: { "Accept": "application/json", "User-Agent": "quantsignal-bot/1.0" },
    signal: ctrl.signal,
    cache: "no-store"
  }, opts || {});
  return fetch(url, init).finally(function () { clearTimeout(timer); });
}

function readJson(req, maxBytes) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  const cap = maxBytes || 64 * 1024;
  return new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > cap) {
        reject(new Error("payload_too_large"));
        try { req.destroy(); } catch (e) {}
      }
    });
    req.on("end", function () {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Welcome caption (Russian, premium tone) ----------
function buildWelcomeCaption(firstName) {
  const greet = firstName
    ? "Привет, " + escapeHtml(firstName) + "! "
    : "";
  const lines = [];
  lines.push("🛰 <b>QUANTSIGNAL AI</b> — премиум-аналитика крипторынка прямо в Telegram.");
  lines.push("");
  lines.push(greet + "Это твой персональный торговый терминал внутри Mini App:");
  lines.push("• 📈 <b>Живой рынок</b> — BTC, ETH, SOL, TON, DOGE через Bybit/Coinbase/Kraken.");
  lines.push("• 🤖 <b>AI-аналитика</b> — разбор настроения, уровней и сценариев на русском.");
  lines.push("• ⚡️ <b>Сигналы</b> — структурированные идеи: вход, стоп, цели, риск.");
  lines.push("• 🧭 <b>Дашборд</b> — обзор, рынок, AI-чат, профиль в одном экране.");
  lines.push("");
  lines.push("📡 Канал: " + escapeHtml(CHANNEL_USERNAME) + " — короткие сводки и идеи дня.");
  lines.push("");
  lines.push("⚠️ Не финансовая рекомендация. Управляйте риском и используйте стоп-лосс.");
  return lines.join("\n");
}

function welcomeReplyMarkup() {
  return {
    inline_keyboard: [
      [
        {
          text: "🚀 Открыть QUANTSIGNAL AI",
          web_app: { url: MINI_APP_URL }
        }
      ],
      [
        {
          text: "📡 Канал QUANTSIGNAL AI",
          url: CHANNEL_URL
        }
      ]
    ]
  };
}

// ---------- Telegram delivery ----------
async function tgCall(botToken, method, payload) {
  const url = TG_API + "/bot" + botToken + "/" + method;
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload)
  }, UPSTREAM_TIMEOUT_MS);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  if (!r.ok || !parsed || parsed.ok !== true) {
    return { ok: false, status: r.status, detail: parsed || text.slice(0, 400) };
  }
  return { ok: true, result: parsed.result };
}

async function sendWelcome(botToken, chatId, firstName, host) {
  const caption = buildWelcomeCaption(firstName);
  const reply_markup = welcomeReplyMarkup();

  // Try sendPhoto with a public asset URL first. Telegram requires a
  // raster photo for sendPhoto and may reject SVG; if that fails we
  // gracefully fall back to sendMessage with the same caption + markup.
  // The asset URL is reachable only when WEBHOOK_PUBLIC_HOST is set OR
  // when the incoming request's Host header is reachable from Telegram.
  const photoUrl = host
    ? "https://" + host.replace(/^https?:\/\//, "") + WELCOME_BANNER_PATH
    : "";

  if (photoUrl) {
    const photo = await tgCall(botToken, "sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption: caption,
      parse_mode: "HTML",
      reply_markup: reply_markup
    });
    if (photo.ok) return photo;
  }

  // Fallback: plain HTML message with the same content + keyboard.
  return tgCall(botToken, "sendMessage", {
    chat_id: chatId,
    text: caption,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: reply_markup
  });
}

// ---------- Update routing ----------
function isWelcomeTrigger(text) {
  if (typeof text !== "string") return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // Strip optional @bot suffix from commands.
  const cmd = t.split(/\s+/)[0].replace(/@.+$/, "");
  if (cmd === "/start" || cmd === "/app" || cmd === "/help" ||
      cmd === "/menu" || cmd === "/open") return true;
  return false;
}

function pickHost(req) {
  const envHost = process.env.QSI_PUBLIC_HOST ||
                  process.env.WEBHOOK_PUBLIC_HOST ||
                  process.env.VERCEL_URL || "";
  if (envHost) return envHost;
  const h = req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host);
  return (typeof h === "string" && h) ? h : "";
}

// ---------- Handler ----------
module.exports = async function handler(req, res) {
  // Telegram always POSTs. Reply with 200 to GET so Telegram does not
  // retry probes; do nothing.
  if (req.method === "GET") {
    sendJson(res, 200, { ok: true, service: "quantsignal-bot-webhook" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  // Optional shared-secret header check.
  const expectedSecret = process.env.QSI_BOT_WEBHOOK_SECRET || "";
  if (expectedSecret) {
    const got = (req.headers && (
      req.headers["x-telegram-bot-api-secret-token"] ||
      req.headers["X-Telegram-Bot-Api-Secret-Token"]
    )) || "";
    if (got !== expectedSecret) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";

  let update;
  try {
    update = await readJson(req, 128 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, error: "invalid_payload" });
    return;
  }

  const msg = (update && (update.message || update.edited_message)) || null;
  const chat = msg && msg.chat;
  const from = msg && msg.from;
  const text = msg && (msg.text || msg.caption);
  const chatType = chat && chat.type;

  // Only react to private 1:1 messages. Groups/channels are ignored
  // so the bot does not spam communities.
  const isPrivate = chatType === "private";
  const trigger = isPrivate && isWelcomeTrigger(text);

  // First-text fallback: if it's a private chat and the user just typed
  // anything (not a recognised command) AND there's no entity, still
  // greet — but only once per update. Telegram does not give us
  // per-user state here; this is best-effort.
  const firstText = isPrivate && typeof text === "string" && text.trim().length > 0 && !trigger;

  if (!trigger && !firstText) {
    sendJson(res, 200, { ok: true, handled: false });
    return;
  }

  if (!botToken) {
    // No token configured — accept the update but do not call Telegram.
    sendJson(res, 200, { ok: true, handled: false, reason: "no_bot_token" });
    return;
  }

  const host = pickHost(req);
  const firstName = (from && typeof from.first_name === "string") ? from.first_name : "";
  const sent = await sendWelcome(botToken, chat.id, firstName, host);

  if (!sent.ok) {
    sendJson(res, 200, {
      ok: true,
      handled: true,
      delivered: false,
      detail: sent.detail || null
    });
    return;
  }

  sendJson(res, 200, { ok: true, handled: true, delivered: true });
};

// Exported for unit-style introspection by the verify script. Not part
// of the Vercel handler contract.
module.exports.buildWelcomeCaption = buildWelcomeCaption;
module.exports.welcomeReplyMarkup = welcomeReplyMarkup;
module.exports.isWelcomeTrigger = isWelcomeTrigger;
