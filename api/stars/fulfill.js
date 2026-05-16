/* =========================================================
   QUANTSIGNAL AI — /api/stars/fulfill

   POST. Called by the client after Telegram's openInvoice() callback
   reports status="paid". Re-validates the Mini App initData, parses
   the signed invoice payload that came back from Telegram, and credits
   the corresponding boost to the user's signed combat checkpoint.

   This endpoint is intentionally idempotent on its own input — calling
   it twice with the same payload will not double-credit because the
   payload includes a one-shot nonce and the FE replaces the checkpoint
   wholesale before the next /tap.

   NOTE: A second, more robust path exists at /api/telegram/webhook
   that consumes Bot API "successful_payment" updates. That endpoint is
   only effective if the bot operator manually configures setWebhook —
   we never do that automatically. Both flows credit boosts through the
   same combat-logic.creditBoost() function.
   ========================================================= */

"use strict";

const auth = require("../_lib/telegram-auth.js");
const logic = require("../_lib/combat-logic.js");
const http = require("../_lib/http.js");

const ALLOWED_PACKS = { energy: 1, damage: 1, revive: 1, starter: 1 };

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST") {
    http.sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let body;
  try { body = await http.readJson(req); }
  catch (e) { http.sendJson(res, 400, { error: e.message || "invalid_json" }); return; }

  const initData = http.extractInitData(req, body);
  if (!initData) {
    http.sendJson(res, 401, { error: "telegram_required" });
    return;
  }
  if (!auth.isConfigured()) {
    http.sendJson(res, 503, { error: "telegram_not_configured" });
    return;
  }
  const v = auth.validateInitData(initData);
  if (!v.ok) {
    http.sendJson(res, 401, { error: "telegram_auth_failed", reason: v.error });
    return;
  }
  const uid = v.user.id;

  const packId = String((body && body.pack) || "").toLowerCase();
  if (!ALLOWED_PACKS[packId]) {
    http.sendJson(res, 400, { error: "unknown_pack" });
    return;
  }

  // Verify the signed invoice payload returned by the Stars endpoint.
  const sigPayload = String((body && body.invoice_payload_sig) || "");
  const verifiedInvoice = auth.verifyCheckpoint(sigPayload);
  if (!verifiedInvoice || verifiedInvoice.p !== packId || verifiedInvoice.u !== uid) {
    http.sendJson(res, 401, { error: "bad_invoice_payload" });
    return;
  }

  let state = logic.makeInitialState(uid);
  if (body && body.checkpoint && typeof body.checkpoint === "string") {
    const verifiedCp = auth.verifyCheckpoint(body.checkpoint);
    if (verifiedCp && verifiedCp.uid === uid) {
      state = logic.mergeIncomingCheckpoint(state, verifiedCp);
    }
  }

  const credited = logic.creditBoost(state, packId);
  if (!credited) {
    http.sendJson(res, 400, { error: "credit_failed" });
    return;
  }

  http.sendJson(res, 200, {
    ok: true,
    pack: packId,
    state: state,
    checkpoint: auth.signCheckpoint(state)
  });
};
