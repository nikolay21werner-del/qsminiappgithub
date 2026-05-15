"""Tests for Telegram initData validation."""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

# Make sure `app` is importable when running `python -m unittest` from backend/.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import unittest

from app.core.telegram_auth import TelegramAuthError, validate_init_data


BOT_TOKEN = "123456:TEST-TOKEN-abcDEF"


def _make_init_data(fields: dict, bot_token: str = BOT_TOKEN) -> str:
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    sig = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    fields_with_hash = dict(fields)
    fields_with_hash["hash"] = sig
    return urlencode(fields_with_hash)


class TelegramAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = int(time.time())
        self.user = {"id": 42, "first_name": "Ada", "language_code": "ru"}
        self.fields = {
            "query_id": "AAH123",
            "user": json.dumps(self.user, separators=(",", ":")),
            "auth_date": str(self.now),
        }

    def test_happy_path(self) -> None:
        data = _make_init_data(self.fields)
        v = validate_init_data(data, BOT_TOKEN, now_ts=self.now)
        self.assertEqual(v.user_id, 42)
        self.assertEqual(v.language_code, "ru")
        self.assertEqual(v.auth_date, self.now)

    def test_tampered_hash_rejected(self) -> None:
        data = _make_init_data(self.fields)
        tampered = data.replace("auth_date=" + str(self.now), "auth_date=" + str(self.now + 1))
        with self.assertRaises(TelegramAuthError):
            validate_init_data(tampered, BOT_TOKEN, now_ts=self.now)

    def test_wrong_token_rejected(self) -> None:
        data = _make_init_data(self.fields)
        with self.assertRaises(TelegramAuthError):
            validate_init_data(data, "different-token", now_ts=self.now)

    def test_expired_rejected(self) -> None:
        data = _make_init_data(self.fields)
        with self.assertRaises(TelegramAuthError):
            validate_init_data(
                data, BOT_TOKEN, max_age_seconds=60, now_ts=self.now + 3600
            )

    def test_missing_hash_rejected(self) -> None:
        with self.assertRaises(TelegramAuthError):
            validate_init_data(urlencode(self.fields), BOT_TOKEN, now_ts=self.now)

    def test_empty_init_data(self) -> None:
        with self.assertRaises(TelegramAuthError):
            validate_init_data("", BOT_TOKEN, now_ts=self.now)

    def test_empty_token(self) -> None:
        data = _make_init_data(self.fields)
        with self.assertRaises(TelegramAuthError):
            validate_init_data(data, "", now_ts=self.now)


if __name__ == "__main__":
    unittest.main()
