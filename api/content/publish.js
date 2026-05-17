/* =========================================================
   QUANTSIGNAL AI — /api/content/publish

   Secret-gated publish endpoint. Posting is DISABLED by default. A real
   Telegram delivery only happens when ALL of:
     - QSI_CHANNEL_POSTING_ENABLED === "1"
     - TELEGRAM_BOT_TOKEN (or BOT_TOKEN) is configured
     - QSI_TELEGRAM_CHANNEL_ID (or TELEGRAM_CHANNEL_ID) is set
     - the caller presents QSI_CRON_SECRET / CRON_SECRET via:
         Authorization: Bearer <secret>   OR   ?secret=<secret>

   When any condition fails the endpoint returns a JSON preview of the
   post it would have sent — never silently no-ops. The canonical label
   JPEG (assets/telegram/quantsignal-label.jpeg) is the image sent via
   sendPhoto, matching api/channel/post.js behavior. The programmatic
   SVG remains the preview-only artifact.

   This file is intentionally side-by-side with api/channel/post.js so
   that the existing scheduled poster keeps working unchanged.
   ========================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const engine = require("../_lib/content-engine");
const brandImg = require("../_lib/brand-image");
const http = require("../_lib/http");

const TG_API = "https://api.telegram.org";
const LABEL_BANNER_RELPATH = "assets/telegram/quantsignal-label.jpeg";
const LABEL_BANNER_CONTENT_TYPE = "image/jpeg";
const LABEL_BANNER_FILENAME = "quantsignal-label.jpeg";
const SEND_TIMEOUT_MS = 12000;

function readLabelBuffer() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "..", LABEL_BANNER_RELPATH));
  } catch (_) {
    return null;
  }
}

function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || SEND_TIMEOUT_MS);
  const init = Object.assign({ method: "GET", signal: ctrl.signal, cache: "no-store" }, opts || {});
  return fetch(url, init).finally(function () { clearTimeout(timer); });
}

function multipartBody(boundary, fields, photo) {
  const CRLF = "\r\n";
  const parts = [];
  for (const k of Object.keys(fields)) {
    parts.push(Buffer.from(
      "--" + boundary + CRLF +
      'Content-Disposition: form-data; name="' + k + '"' + CRLF + CRLF +
      String(fields[k]) + CRLF
    ));
  }
  parts.push(Buffer.from(
    "--" + boundary + CRLF +
    'Content-Disposition: form-data; name="photo"; filename="' + photo.filename + '"' + CRLF +
    "Content-Type: " + photo.contentType + CRLF + CRLF
  ));
  parts.push(photo.buffer);
  parts.push(Buffer.from(CRLF + "--" + boundary + "--" + CRLF));
  return Buffer.concat(parts);
}

async function sendPhoto(botToken, chatId, caption, buf) {
  const boundary = "----QSI" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const url = TG_API + "/bot" + botToken + "/sendPhoto";
  const fields = {
    chat_id: chatId,
    caption: caption,
    parse_mode: "HTML",
    disable_notification: "false"
  };
  const body = multipartBody(boundary, fields, {
    filename: LABEL_BANNER_FILENAME,
    contentType: LABEL_BANNER_CONTENT_TYPE,
    buffer: buf
  });
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
    body: body
  }, SEND_TIMEOUT_MS);
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) {}
  if (r.ok && parsed && parsed.ok === true) {
    return { ok: true, message_id: parsed.result && parsed.result.message_id };
  }
  return { ok: false, status: r.status, detail: parsed || text.slice(0, 400) };
}

function isAuthorized(req) {
  const secret = process.env.QSI_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return false; // publish requires a secret to exist
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  if (typeof h === "string" && h.startsWith("Bearer ") && h.slice(7) === secret) return true;
  try {
    const url = new URL(req.url, "http://x");
    if (url.searchParams.get("secret") === secret) return true;
  } catch (_) {}
  return false;
}

function parseQuery(req) {
  try {
    const u = new URL(req.url, "http://x");
    return {
      type: (u.searchParams.get("type") || "market_update").toLowerCase(),
      symbol: (u.searchParams.get("symbol") || "").toUpperCase() || null,
      dryRun: u.searchParams.get("dry_run") === "1" || u.searchParams.get("preview") === "1"
    };
  } catch (_) {
    return { type: "market_update", symbol: null, dryRun: false };
  }
}

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "GET" && req.method !== "POST") {
    http.sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const q = parseQuery(req);
  if (engine.TYPES.indexOf(q.type) < 0) {
    http.sendJson(res, 400, { ok: false, error: "invalid_type", allowed: engine.TYPES });
    return;
  }

  const enabled = String(process.env.QSI_CHANNEL_POSTING_ENABLED || "").trim() === "1";
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  const chatId = process.env.QSI_TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID || "";

  // Auth is required even for previews of the publish route, because
  // /api/content/preview is the public read path. This keeps every
  // future operator action behind a single secret.
  if (!isAuthorized(req)) {
    http.sendJson(res, 401, {
      ok: false,
      error: "unauthorized",
      hint: "Provide QSI_CRON_SECRET via Authorization: Bearer <secret> or ?secret=<secret>"
    });
    return;
  }

  let plan;
  try {
    plan = await engine.planForType(q.type, { symbol: q.symbol });
  } catch (e) {
    http.sendJson(res, 502, {
      ok: false,
      error: "content_engine_failed",
      detail: String(e && e.message || e)
    });
    return;
  }

  const img = brandImg.renderForPlan(plan);

  if (q.dryRun || !enabled || !botToken || !chatId) {
    http.sendJson(res, 200, {
      ok: true,
      mode: "preview",
      reason: q.dryRun ? "dry_run"
            : !enabled ? "QSI_CHANNEL_POSTING_ENABLED!=1"
            : !botToken ? "TELEGRAM_BOT_TOKEN missing"
            : "QSI_TELEGRAM_CHANNEL_ID missing",
      type: plan.type,
      symbol: plan.symbol,
      headline: plan.headline,
      caption_html: plan.caption_html,
      image_svg_base64: img.svg_base64,
      image_content_type: img.content_type,
      image_path: "/" + LABEL_BANNER_RELPATH,
      snapshot: plan.snapshot,
      warnings: plan.warnings
    });
    return;
  }

  const buf = readLabelBuffer();
  if (!buf) {
    http.sendJson(res, 500, { ok: false, error: "label_image_unavailable" });
    return;
  }

  const send = await sendPhoto(botToken, chatId, plan.caption_html, buf);
  if (!send.ok) {
    http.sendJson(res, 502, { ok: false, error: "telegram_send_failed", status: send.status, detail: send.detail });
    return;
  }

  http.sendJson(res, 200, {
    ok: true,
    mode: "posted",
    message_id: send.message_id,
    type: plan.type,
    symbol: plan.symbol,
    headline: plan.headline,
    warnings: plan.warnings
  });
};
