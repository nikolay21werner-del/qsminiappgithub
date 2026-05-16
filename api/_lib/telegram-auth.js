/* =========================================================
   QUANTSIGNAL AI — Telegram Mini App initData validator

   Implements the official Telegram Bot Mini App auth check:
     https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

   Algorithm:
     1. Parse initData as a URL-encoded query string.
     2. Strip the `hash` parameter, sort the remaining keys, and join
        as `key=value\nkey=value` (data_check_string).
     3. secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
     4. expected = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
     5. Reject if expected !== hash.
     6. Reject if auth_date is older than MAX_AGE_SECONDS (default 24h).

   Returns { ok: true, user, authDate, raw } on success, otherwise
   { ok: false, error }. The bot token is read from env only; never
   logged, never echoed to the response.

   Also exports a small HMAC checkpoint signer used for state
   integrity when there is no database — the server signs a payload
   blob the client stores in Telegram CloudStorage so we can detect
   tampering on subsequent /tap calls.
   ========================================================= */

"use strict";

const crypto = require("crypto");

const MAX_AGE_SECONDS = 24 * 60 * 60;

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "";
}

function getCheckpointSecret() {
  // Reuse the bot token as the HMAC secret for state checkpoints when no
  // dedicated secret is set. The bot token never leaves the server.
  return (
    process.env.QSI_CHECKPOINT_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    ""
  );
}

function isConfigured() {
  return !!getBotToken();
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch (e) {
    return false;
  }
}

function parseInitData(initData) {
  // Parse manually to preserve original encoded value of `user`, which
  // is itself a URL-encoded JSON blob whose UTF-8 bytes must match
  // exactly when computing the HMAC.
  const out = {};
  if (typeof initData !== "string" || !initData) return out;
  const pairs = initData.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const eq = pairs[i].indexOf("=");
    if (eq < 0) continue;
    const k = pairs[i].slice(0, eq);
    const v = pairs[i].slice(eq + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function validateInitData(initData, opts) {
  const token = getBotToken();
  if (!token) return { ok: false, error: "telegram_not_configured" };
  if (!initData || typeof initData !== "string") {
    return { ok: false, error: "missing_init_data" };
  }
  if (initData.length > 8192) return { ok: false, error: "init_data_too_large" };

  const parsed = parseInitData(initData);
  const hash = parsed.hash;
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    return { ok: false, error: "missing_hash" };
  }

  const keys = Object.keys(parsed).filter(function (k) { return k !== "hash"; }).sort();
  const dataCheckString = keys.map(function (k) { return k + "=" + parsed[k]; }).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(expected, hash.toLowerCase())) {
    return { ok: false, error: "bad_signature" };
  }

  const authDate = parseInt(parsed.auth_date, 10);
  if (!Number.isFinite(authDate)) return { ok: false, error: "bad_auth_date" };
  const maxAge = (opts && opts.maxAgeSeconds) || MAX_AGE_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAge) return { ok: false, error: "auth_expired" };
  if (authDate - now > 60) return { ok: false, error: "auth_in_future" };

  let user = null;
  if (parsed.user) {
    try {
      const u = JSON.parse(parsed.user);
      if (u && typeof u.id === "number") {
        user = {
          id: u.id,
          first_name: typeof u.first_name === "string" ? u.first_name.slice(0, 64) : "",
          last_name: typeof u.last_name === "string" ? u.last_name.slice(0, 64) : "",
          username: typeof u.username === "string" ? u.username.slice(0, 64) : "",
          language_code: typeof u.language_code === "string" ? u.language_code.slice(0, 16) : "",
          is_premium: !!u.is_premium
        };
      }
    } catch (e) {
      return { ok: false, error: "bad_user_json" };
    }
  }
  if (!user) return { ok: false, error: "missing_user" };

  return { ok: true, user: user, authDate: authDate, raw: parsed };
}

/* ---------- Signed state checkpoint (HMAC) ---------- */

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str) {
  if (typeof str !== "string") return null;
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  try {
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  } catch (e) { return null; }
}

function signCheckpoint(payload) {
  const secret = getCheckpointSecret();
  if (!secret) return null;
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest();
  return body + "." + b64urlEncode(sig);
}

function verifyCheckpoint(token) {
  const secret = getCheckpointSecret();
  if (!secret || typeof token !== "string" || !token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64urlEncode(
    crypto.createHmac("sha256", secret).update(body).digest()
  );
  // Constant-time compare on the base64url sigs.
  if (expected.length !== sig.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch (e) { return null; }
  const raw = b64urlDecode(body);
  if (!raw) return null;
  try { return JSON.parse(raw.toString("utf8")); }
  catch (e) { return null; }
}

module.exports = {
  isConfigured: isConfigured,
  validateInitData: validateInitData,
  signCheckpoint: signCheckpoint,
  verifyCheckpoint: verifyCheckpoint,
  MAX_AGE_SECONDS: MAX_AGE_SECONDS
};
