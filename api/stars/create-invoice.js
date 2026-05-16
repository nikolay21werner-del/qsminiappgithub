/* =========================================================
   QUANTSIGNAL AI — /api/stars/create-invoice
   Vercel serverless function that wraps Telegram Bot API
   `createInvoiceLink` for the in-app Crypto Combat boost
   packs paid in Telegram Stars (currency code "XTR").

   Required env vars (configure in Vercel project settings):
     TELEGRAM_BOT_TOKEN   — preferred name
     BOT_TOKEN            — accepted fallback name

   The endpoint NEVER hard-codes a token. If neither env var
   is present it returns a structured 503 error so the FE can
   show a clear non-paid fallback (no broken flow).

   Telegram Stars rules:
     - currency MUST be "XTR"
     - prices is a single LabeledPrice in stars (whole units)
     - provider_token MUST be empty for Stars
   See: https://core.telegram.org/bots/payments-stars

   The invoice payload is an opaque token that we sign with HMAC and
   send to Telegram. After payment, the FE calls /api/stars/fulfill
   with this token + a fresh initData; the server verifies the HMAC
   and, only if it matches, credits the boost. This prevents the
   client from claiming a boost it didn't pay for.
   ========================================================= */

"use strict";

const auth = require("../_lib/telegram-auth.js");
const http = require("../_lib/http.js");

const ALLOWED_PACKS = {
  energy:  { amount: 25,  title: "Energy refill",  description: "Refill combat energy to max." },
  damage:  { amount: 75,  title: "Damage boost",   description: "+50% tap damage for the next fight." },
  revive:  { amount: 50,  title: "Revive",         description: "Revive fighter and restore HP." },
  starter: { amount: 100, title: "Starter pack",   description: "Energy refill + damage boost combo." }
};

function sanitizeStr(value, maxLen) {
  if (value == null) return "";
  let s = String(value);
  s = s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST") { http.sendJson(res, 405, { error: "method_not_allowed" }); return; }

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  if (!token) {
    http.sendJson(res, 503, {
      error: "stars_not_configured",
      message:
        "Telegram bot token is not configured. " +
        "Set TELEGRAM_BOT_TOKEN (or BOT_TOKEN) in the deployment " +
        "environment to enable Stars payments."
    });
    return;
  }

  let body;
  try { body = await http.readJson(req); }
  catch (e) { http.sendJson(res, 400, { error: e.message || "invalid_json" }); return; }

  const packId = sanitizeStr(body && body.pack, 32).toLowerCase();
  const pack = ALLOWED_PACKS[packId];
  if (!pack) {
    http.sendJson(res, 400, {
      error: "unknown_pack",
      allowed: Object.keys(ALLOWED_PACKS)
    });
    return;
  }

  // Validate Telegram initData when supplied so we can bind the invoice
  // payload to a verified user_id. If absent, we still allow invoice
  // creation but the fulfillment endpoint will reject claims that don't
  // come back with a matching verified initData.
  const initData = http.extractInitData(req, body);
  let verifiedUid = null;
  if (initData) {
    const v = auth.validateInitData(initData);
    if (!v.ok) {
      http.sendJson(res, 401, { error: "telegram_auth_failed", reason: v.error });
      return;
    }
    verifiedUid = v.user.id;
  }

  const symbol = sanitizeStr(body && body.symbol, 20).toUpperCase().replace(/[^A-Z0-9._-]/g, "");

  // Signed payload: HMAC binds pack + user id together so /fulfill can
  // trust it. The compact JSON also rides inside Telegram's `payload`
  // field (echoed back via successful_payment) up to its 128-byte cap.
  const payloadBlob = {
    p: packId,
    u: verifiedUid,
    s: symbol || null,
    t: Date.now(),
    n: Math.random().toString(36).slice(2, 12)
  };
  const signedPayload = auth.signCheckpoint(payloadBlob);
  const tgInvoicePayload = JSON.stringify({
    p: packId, u: verifiedUid, t: payloadBlob.t, n: payloadBlob.n
  }).slice(0, 128);

  const tgPayload = {
    title: pack.title,
    description: pack.description,
    payload: tgInvoicePayload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: pack.title, amount: pack.amount }]
  };

  const url = "https://api.telegram.org/bot" + token + "/createInvoiceLink";
  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 15000);
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgPayload),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    http.sendJson(res, 504, {
      error: aborted ? "stars_upstream_timeout" : "stars_upstream_unreachable"
    });
    return;
  }

  let data;
  try { data = await upstream.json(); }
  catch (e) { http.sendJson(res, 502, { error: "stars_upstream_bad_json" }); return; }

  if (!upstream.ok || !data || data.ok !== true || !data.result) {
    const desc = data && (data.description || data.error_code)
      ? String(data.description || data.error_code).slice(0, 200)
      : null;
    http.sendJson(res, 502, {
      error: "stars_upstream_error",
      status: upstream.status,
      detail: desc
    });
    return;
  }

  http.sendJson(res, 200, {
    invoice_link: String(data.result),
    pack: packId,
    amount: pack.amount,
    currency: "XTR",
    payload_sig: signedPayload,
    user_bound: !!verifiedUid,
    ts: Date.now()
  });
};
