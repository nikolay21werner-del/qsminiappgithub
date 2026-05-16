/* =========================================================
   QUANTSIGNAL AI — /api/telegram/webhook

   Optional webhook for Bot API updates. Only effective if the bot
   operator manually configures setWebhook to point here AND sets the
   TELEGRAM_WEBHOOK_SECRET env var to a strong random string. This
   subagent does NOT call setWebhook for you.

   We process two update kinds:
     - pre_checkout_query  → answer ok=true so Stars payment proceeds
     - message.successful_payment → log + return 200 (boost crediting
       still goes through the client-side /fulfill path because that
       carries the signed checkpoint the rest of the system uses)

   This endpoint never exposes the bot token. It only uses the token
   for the answerPreCheckoutQuery call. If the secret env var is unset
   the endpoint refuses to act.
   ========================================================= */

"use strict";

const http = require("../_lib/http.js");

function timingSafeStrEq(a, b) {
  try {
    const crypto = require("crypto");
    const ba = Buffer.from(String(a || ""));
    const bb = Buffer.from(String(b || ""));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST") {
    http.sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!token || !expectedSecret) {
    http.sendJson(res, 503, { error: "webhook_not_configured" });
    return;
  }
  // Telegram sends the secret in this header when configured via setWebhook.
  const got = req.headers && req.headers["x-telegram-bot-api-secret-token"];
  if (!got || !timingSafeStrEq(got, expectedSecret)) {
    http.sendJson(res, 401, { error: "bad_webhook_secret" });
    return;
  }

  let update;
  try { update = await http.readJson(req); }
  catch (e) { http.sendJson(res, 400, { error: e.message || "invalid_json" }); return; }

  // pre_checkout_query — must respond within 10s or Telegram cancels.
  if (update && update.pre_checkout_query && update.pre_checkout_query.id) {
    const queryId = update.pre_checkout_query.id;
    try {
      const url = "https://api.telegram.org/bot" + token + "/answerPreCheckoutQuery";
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pre_checkout_query_id: queryId, ok: true })
      });
    } catch (e) { /* ignore — Telegram will retry */ }
    http.sendJson(res, 200, { ok: true });
    return;
  }

  // successful_payment — observed only; crediting goes through /fulfill.
  if (update && update.message && update.message.successful_payment) {
    // We deliberately do not log payment payloads; just acknowledge.
    http.sendJson(res, 200, { ok: true, observed: "successful_payment" });
    return;
  }

  http.sendJson(res, 200, { ok: true, observed: "ignored" });
};
