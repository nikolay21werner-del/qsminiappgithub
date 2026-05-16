/* =========================================================
   QUANTSIGNAL AI — /api/combat/state

   GET or POST. Validates Telegram initData (required for "real" mode),
   then either:
     - returns a fresh server-side initial state for this user, OR
     - re-signs the client's signed checkpoint after regenerating energy
       against the wall clock.

   No database: persistence lives in Telegram CloudStorage on the client,
   protected by an HMAC checkpoint signed here. If initData is missing
   we return state but mark mode="offline" so the FE can label it.
   ========================================================= */

"use strict";

const auth = require("../_lib/telegram-auth.js");
const logic = require("../_lib/combat-logic.js");
const http = require("../_lib/http.js");

module.exports = async function handler(req, res) {
  http.applyCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method !== "POST" && req.method !== "GET") {
    http.sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let body = {};
  if (req.method === "POST") {
    try { body = await http.readJson(req); }
    catch (e) { http.sendJson(res, 400, { error: e.message || "invalid_json" }); return; }
  }

  const initData = http.extractInitData(req, body);
  const cfg = auth.isConfigured();
  let user = null;
  let mode = "offline";

  if (initData && cfg) {
    const v = auth.validateInitData(initData);
    if (!v.ok) {
      http.sendJson(res, 401, { error: "telegram_auth_failed", reason: v.error });
      return;
    }
    user = v.user;
    mode = "telegram";
  } else if (!cfg) {
    mode = "unconfigured";
  }

  const uid = user ? user.id : 0;
  let state;
  let signed = null;

  if (body && body.checkpoint && typeof body.checkpoint === "string") {
    const verified = auth.verifyCheckpoint(body.checkpoint);
    if (verified && verified.uid === uid) {
      state = logic.makeInitialState(uid);
      state = logic.mergeIncomingCheckpoint(state, verified);
    }
  }
  if (!state) {
    state = logic.makeInitialState(uid);
  }

  // Always regen against current clock before sending.
  logic.regenEnergy(state, Date.now());

  signed = auth.signCheckpoint(state);
  http.sendJson(res, 200, {
    ok: true,
    mode: mode,
    user: user ? {
      id: user.id, first_name: user.first_name, username: user.username,
      language_code: user.language_code
    } : null,
    state: state,
    checkpoint: signed,
    config: {
      maxTapsPerBatch: logic.MAX_TAPS_PER_BATCH,
      energyRegenMs: logic.ENERGY_REGEN_MS,
      dailyRewardQp: logic.DAILY_REWARD_QP,
      xpPerLevel: logic.XP_PER_LEVEL
    }
  });
};
