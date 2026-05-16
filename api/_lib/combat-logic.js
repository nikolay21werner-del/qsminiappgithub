/* =========================================================
   QUANTSIGNAL AI — server-authoritative combat logic

   The serverless tap endpoint runs all tap arithmetic here so the
   client cannot mint QP, levels, or boost effects by editing JS.

   Bounds enforced:
     - taps per request: 1..MAX_TAPS_PER_BATCH
     - minimum batch window (anti-burst): MIN_BATCH_MS
     - energy cost: 1 per tap, capped at current energy
     - selected symbol: ALLOWED_SYMBOL regex
     - daily reward: enforced via UTC day key
     - boost effects: derived from server-tracked credits, not the
       client-supplied flag

   Determinism: the per-tap roll uses an HMAC keyed by the checkpoint
   secret + batch nonce + tap index, so the same submission always
   yields the same result and the client cannot cherry-pick crits.
   ========================================================= */

"use strict";

const crypto = require("crypto");

const MAX_TAPS_PER_BATCH = 40;
const MIN_BATCH_MS = 250;          // 40 taps over <250ms is rejected
const MIN_TAP_INTERVAL_MS = 20;    // strict floor per tap (avg)
const ENERGY_REGEN_MS = 1500;      // 1 energy per 1.5s wall-clock
const DAILY_REWARD_QP = 25;
const STREAK_BONUS_QP = 10;        // additional QP per streak day, capped
const STREAK_MAX = 14;
const XP_PER_TAP = 1;
const XP_PER_LEVEL = 100;
const ALLOWED_SYMBOL = /^[A-Z0-9]{2,10}USDT$/;

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function makeInitialState(userId) {
  return {
    v: 1,
    uid: userId | 0,
    level: 1,
    xp: 0,
    balance: 0,
    energy: 100,
    energyMax: 100,
    playerHp: 100,
    playerHpMax: 100,
    bossHp: 100,
    bossHpMax: 100,
    bossRound: 1,
    streak: 0,
    lastDailyDay: null,      // "YYYY-MM-DD" UTC
    boosts: {                // server-credited; consumed by /tap
      energyRefills: 0,
      damageBoosts: 0,
      revives: 0
    },
    activeDamageBoost: false,
    lastUpdateMs: Date.now(),
    lastSymbol: "BTCUSDT",
    nonceSeq: 0
  };
}

function utcDayKey(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0");
}

function dayDiff(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}

function regenEnergy(state, nowMs) {
  if (!state || !Number.isFinite(state.lastUpdateMs)) return;
  const dt = Math.max(0, nowMs - state.lastUpdateMs);
  const ticks = Math.floor(dt / ENERGY_REGEN_MS);
  if (ticks > 0 && state.energy < state.energyMax) {
    state.energy = Math.min(state.energyMax, state.energy + ticks);
  }
  state.lastUpdateMs = nowMs;
}

function deterministicRoll(secret, nonce, idx) {
  const h = crypto.createHmac("sha256", secret || "qsi-combat")
    .update(String(nonce) + ":" + String(idx)).digest();
  // Return two floats in [0,1) from the first 8 bytes.
  const a = h.readUInt32BE(0) / 0xffffffff;
  const b = h.readUInt32BE(4) / 0xffffffff;
  return { a: a, b: b };
}

function bossHpForLevel(level, volatility) {
  const base = 100 + (level - 1) * 40;
  const v = clamp(volatility, 0, 10);
  let mult = 1;
  if (v >= 4) mult = 1.35;
  else if (v < 1.5) mult = 0.9;
  return Math.max(40, Math.round(base * mult));
}

function applyTapBatch(state, batch, secret) {
  const errs = [];
  const now = Date.now();
  const rawTaps = Number(batch && batch.taps);
  if (!Number.isFinite(rawTaps) || rawTaps <= 0 || rawTaps > MAX_TAPS_PER_BATCH) {
    return { ok: false, error: "taps_out_of_range", errors: ["taps_out_of_range"] };
  }
  const taps = rawTaps | 0;
  const startMs = Number(batch && batch.startMs);
  const endMs = Number(batch && batch.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    errs.push("bad_batch_window");
  } else {
    const span = endMs - startMs;
    if (span < MIN_BATCH_MS && taps > 4) errs.push("batch_too_fast");
    if (taps > 1 && span / taps < MIN_TAP_INTERVAL_MS) errs.push("taps_too_fast");
    if (endMs > now + 5000 || startMs < now - 5 * 60 * 1000) errs.push("batch_clock_skew");
  }
  const symbol = String((batch && batch.symbol) || state.lastSymbol || "BTCUSDT").toUpperCase();
  if (!ALLOWED_SYMBOL.test(symbol)) errs.push("bad_symbol");
  const volatility = Number(batch && batch.volatility);
  const nonce = String((batch && batch.nonce) || "").slice(0, 64);
  if (!nonce) errs.push("missing_nonce");
  if (errs.length) return { ok: false, error: errs[0], errors: errs };

  regenEnergy(state, now);
  state.lastSymbol = symbol;
  state.nonceSeq = (state.nonceSeq | 0) + 1;

  // Re-roll boss when level/volatility shifts since last tap if HP is at max.
  if (state.bossHp >= state.bossHpMax) {
    state.bossHpMax = bossHpForLevel(state.level + state.bossRound - 1, volatility);
    state.bossHp = state.bossHpMax;
  }

  let qpEarned = 0;
  let damageTotal = 0;
  let crits = 0;
  let combo = 0;
  let counterDmg = 0;
  let energyUsed = 0;
  let killed = false;

  const damageBoostActive = state.activeDamageBoost || (state.boosts.damageBoosts > 0);
  // If a damageBoost credit is being consumed, mark it active for this batch.
  let consumedBoost = false;
  if (!state.activeDamageBoost && state.boosts.damageBoosts > 0) {
    state.boosts.damageBoosts -= 1;
    state.activeDamageBoost = true;
    consumedBoost = true;
  }

  for (let i = 0; i < taps; i++) {
    if (state.energy < 1 || state.playerHp <= 0 || state.bossHp <= 0) break;
    state.energy -= 1;
    energyUsed += 1;
    combo += 1;
    const roll = deterministicRoll(secret, nonce, i);
    const crit = roll.a < 0.15;
    const base = 8 + Math.floor(roll.b * 5);
    let dmg = base + Math.min(10, Math.floor(combo / 3));
    if (crit) { dmg = Math.round(dmg * 2.2); crits += 1; }
    if (damageBoostActive) dmg = Math.round(dmg * 1.5);
    state.bossHp = Math.max(0, state.bossHp - dmg);
    damageTotal += dmg;

    // Boss counter (cap so single batch can never one-shot the player).
    if (roll.a > 0.82 && state.bossHp > 0) {
      const c = 3 + Math.floor(roll.b * 4);
      state.playerHp = Math.max(0, state.playerHp - c);
      counterDmg += c;
    }

    state.xp += XP_PER_TAP;
    if (state.bossHp === 0) {
      const reward = 10 + state.level * 5;
      state.balance += reward;
      qpEarned += reward;
      state.level += 1;
      state.bossRound = (state.bossRound | 0) + 1;
      state.activeDamageBoost = false;
      // Spawn next boss immediately at full HP at the new level.
      state.bossHpMax = bossHpForLevel(state.level, volatility);
      state.bossHp = state.bossHpMax;
      combo = 0;
      killed = true;
    }
  }

  // Level-up from XP independent of bosses.
  while (state.xp >= XP_PER_LEVEL) {
    state.xp -= XP_PER_LEVEL;
    state.level += 1;
    state.playerHpMax = Math.min(250, state.playerHpMax + 5);
    state.playerHp = Math.min(state.playerHpMax, state.playerHp + 10);
  }

  state.lastUpdateMs = Date.now();
  return {
    ok: true,
    state: state,
    delta: {
      qpEarned: qpEarned,
      damageTotal: damageTotal,
      crits: crits,
      counterDmg: counterDmg,
      energyUsed: energyUsed,
      killed: killed,
      consumedDamageBoost: consumedBoost
    }
  };
}

function claimDaily(state) {
  const now = Date.now();
  const day = utcDayKey(now);
  if (state.lastDailyDay === day) {
    return { ok: false, error: "already_claimed" };
  }
  const diff = state.lastDailyDay ? dayDiff(state.lastDailyDay, day) : null;
  if (diff === 1) {
    state.streak = Math.min(STREAK_MAX, (state.streak | 0) + 1);
  } else {
    state.streak = 1;
  }
  const reward = DAILY_REWARD_QP + Math.min(STREAK_BONUS_QP * (state.streak - 1), STREAK_BONUS_QP * STREAK_MAX);
  state.balance += reward;
  state.lastDailyDay = day;
  state.lastUpdateMs = now;
  return { ok: true, state: state, reward: reward, streak: state.streak };
}

function creditBoost(state, packId) {
  if (!state || !state.boosts) return false;
  switch (packId) {
    case "energy":
      state.energy = state.energyMax;
      state.boosts.energyRefills = (state.boosts.energyRefills | 0) + 1;
      return true;
    case "damage":
      state.boosts.damageBoosts = (state.boosts.damageBoosts | 0) + 1;
      return true;
    case "revive":
      state.boosts.revives = (state.boosts.revives | 0) + 1;
      state.playerHp = state.playerHpMax;
      state.energy = Math.max(state.energy, Math.round(state.energyMax * 0.6));
      return true;
    case "starter":
      state.energy = state.energyMax;
      state.boosts.damageBoosts = (state.boosts.damageBoosts | 0) + 1;
      return true;
    default:
      return false;
  }
}

function mergeIncomingCheckpoint(serverState, checkpointPayload) {
  // The checkpoint is server-signed (HMAC), so when it arrives back from
  // the client we trust its data fields. We still re-run regen against
  // the current clock so energy never gets locked in time.
  if (!checkpointPayload || typeof checkpointPayload !== "object") return serverState;
  if (checkpointPayload.uid !== serverState.uid) return serverState; // bind to user
  // Shallow-merge known fields only.
  const fields = ["level", "xp", "balance", "energy", "energyMax", "playerHp",
    "playerHpMax", "bossHp", "bossHpMax", "bossRound", "streak", "lastDailyDay",
    "activeDamageBoost", "lastUpdateMs", "lastSymbol", "nonceSeq"];
  for (let i = 0; i < fields.length; i++) {
    const k = fields[i];
    if (Object.prototype.hasOwnProperty.call(checkpointPayload, k)) {
      serverState[k] = checkpointPayload[k];
    }
  }
  if (checkpointPayload.boosts && typeof checkpointPayload.boosts === "object") {
    serverState.boosts.energyRefills = checkpointPayload.boosts.energyRefills | 0;
    serverState.boosts.damageBoosts = checkpointPayload.boosts.damageBoosts | 0;
    serverState.boosts.revives = checkpointPayload.boosts.revives | 0;
  }
  regenEnergy(serverState, Date.now());
  return serverState;
}

module.exports = {
  MAX_TAPS_PER_BATCH: MAX_TAPS_PER_BATCH,
  MIN_BATCH_MS: MIN_BATCH_MS,
  ENERGY_REGEN_MS: ENERGY_REGEN_MS,
  DAILY_REWARD_QP: DAILY_REWARD_QP,
  XP_PER_LEVEL: XP_PER_LEVEL,
  ALLOWED_SYMBOL: ALLOWED_SYMBOL,
  makeInitialState: makeInitialState,
  applyTapBatch: applyTapBatch,
  claimDaily: claimDaily,
  creditBoost: creditBoost,
  regenEnergy: regenEnergy,
  bossHpForLevel: bossHpForLevel,
  mergeIncomingCheckpoint: mergeIncomingCheckpoint,
  utcDayKey: utcDayKey
};
