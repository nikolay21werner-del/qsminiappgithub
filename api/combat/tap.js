/* =========================================================
   QUANTSIGNAL AI — /api/combat/tap

   POST. Server-authoritative tap batch.

   Body:
     {
       initData?,                 // or X-Telegram-Init-Data header
       checkpoint?,               // last signed state from /state
       batch: {
         taps: int (1..MAX_TAPS_PER_BATCH),
         startMs, endMs,          // client wall-clock window
         symbol: "BTCUSDT" etc.,
         volatility: number,
         nonce: opaque string
       },
       action?: "daily" | "tap"   // default "tap"
     }

   Real-mode requires valid Telegram initData. Without it the endpoint
   responds 401 telegram_required so the FE knows real play needs Telegram.
   ========================================================= */

"use strict";

const auth = require("../_lib/telegram-auth.js");
const logic = require("../_lib/combat-logic.js");
const http = require("../_lib/http.js");

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
    http.sendJson(res, 401, { error: "telegram_required",
      message: "Real-mode taps require a valid Telegram Mini App initData." });
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

  // Reload server state from the signed checkpoint (no DB).
  let state = logic.makeInitialState(uid);
  if (body && body.checkpoint && typeof body.checkpoint === "string") {
    const verified = auth.verifyCheckpoint(body.checkpoint);
    if (verified && verified.uid === uid) {
      state = logic.mergeIncomingCheckpoint(state, verified);
    } else if (verified) {
      http.sendJson(res, 401, { error: "checkpoint_user_mismatch" });
      return;
    } else {
      http.sendJson(res, 400, { error: "bad_checkpoint" });
      return;
    }
  }

  const action = (body && body.action) || "tap";
  if (action === "daily") {
    const result = logic.claimDaily(state);
    if (!result.ok) {
      http.sendJson(res, 200, {
        ok: false, error: result.error, state: state,
        checkpoint: auth.signCheckpoint(state)
      });
      return;
    }
    http.sendJson(res, 200, {
      ok: true, reward: result.reward, streak: result.streak,
      state: state, checkpoint: auth.signCheckpoint(state)
    });
    return;
  }

  if (!body || typeof body.batch !== "object" || !body.batch) {
    http.sendJson(res, 400, { error: "missing_batch" });
    return;
  }

  const secret = process.env.QSI_CHECKPOINT_SECRET || process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN || "";
  const result = logic.applyTapBatch(state, body.batch, secret);
  if (!result.ok) {
    http.sendJson(res, 400, {
      error: result.error, errors: result.errors,
      state: state, checkpoint: auth.signCheckpoint(state)
    });
    return;
  }
  http.sendJson(res, 200, {
    ok: true,
    delta: result.delta,
    state: result.state,
    checkpoint: auth.signCheckpoint(result.state)
  });
};
