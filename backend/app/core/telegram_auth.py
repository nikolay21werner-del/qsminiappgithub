"""Server-side Telegram WebApp `initData` validation.

Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Algorithm:
  1. Parse the raw `initData` query string – DO NOT trust `initDataUnsafe`.
  2. Extract and remove the `hash` field; keep all other fields.
  3. Build the data-check-string: `key=value` pairs sorted alphabetically by key,
     joined by `\n`.
  4. Derive `secret_key = HMAC_SHA256(key=b"WebAppData", msg=bot_token)`.
  5. Compute `HMAC_SHA256(secret_key, data_check_string).hexdigest()`.
  6. Compare with the supplied `hash` using `hmac.compare_digest`.
  7. Validate `auth_date` is not older than `max_age` seconds.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl


class TelegramAuthError(Exception):
    """Raised when initData fails validation."""


@dataclass
class ValidatedInitData:
    raw: str
    fields: Dict[str, str]
    user: Optional[Dict[str, Any]]
    auth_date: int

    @property
    def user_id(self) -> Optional[int]:
        return self.user.get("id") if self.user else None

    @property
    def language_code(self) -> Optional[str]:
        # Available but **not** to be trusted for authorization decisions –
        # only useful for UI hints. We still expose it to the caller.
        return self.user.get("language_code") if self.user else None


def _build_data_check_string(fields: Dict[str, str]) -> str:
    items = [f"{k}={v}" for k, v in sorted(fields.items())]
    return "\n".join(items)


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int = 86_400,
    now_ts: Optional[int] = None,
) -> ValidatedInitData:
    """Validate a Telegram WebApp `initData` string.

    Args:
        init_data: The raw `initData` string as received from the Telegram client
            (typically via `window.Telegram.WebApp.initData`).
        bot_token: The Telegram bot token, kept secret on the server.
        max_age_seconds: Reject `initData` older than this many seconds.
        now_ts: Override for the current timestamp (used in tests).

    Returns:
        A `ValidatedInitData` instance with parsed user and metadata.

    Raises:
        TelegramAuthError: If the data is malformed, the HMAC does not match,
            `auth_date` is missing/invalid, or the data is too old.
    """
    if not init_data:
        raise TelegramAuthError("initData is empty")
    if not bot_token:
        raise TelegramAuthError("bot token is not configured")

    # parse_qsl preserves order and decodes percent-escapes. We keep values
    # as-is because Telegram signs the *decoded* representation.
    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
    fields: Dict[str, str] = dict(pairs)

    received_hash = fields.pop("hash", None)
    if not received_hash:
        raise TelegramAuthError("hash field missing")

    data_check_string = _build_data_check_string(fields)
    secret = _secret_key(bot_token)
    computed = hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed, received_hash):
        raise TelegramAuthError("hash mismatch")

    # auth_date freshness check.
    auth_date_raw = fields.get("auth_date")
    if not auth_date_raw or not auth_date_raw.isdigit():
        raise TelegramAuthError("auth_date missing or invalid")
    auth_date = int(auth_date_raw)
    current = now_ts if now_ts is not None else int(time.time())
    if current - auth_date > max_age_seconds:
        raise TelegramAuthError("initData expired")
    if auth_date - current > 60:  # small clock-skew tolerance
        raise TelegramAuthError("auth_date in the future")

    user: Optional[Dict[str, Any]] = None
    if "user" in fields:
        try:
            user = json.loads(fields["user"])
        except json.JSONDecodeError:
            raise TelegramAuthError("user payload is not valid JSON") from None

    return ValidatedInitData(
        raw=init_data,
        fields=fields,
        user=user,
        auth_date=auth_date,
    )
