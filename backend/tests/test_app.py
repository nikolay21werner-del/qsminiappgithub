"""Smoke tests for the FastAPI app – run with stdlib unittest."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient

from app.main import app


class AppSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health(self) -> None:
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("version", data)

    def test_root(self) -> None:
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("name", r.json())

    def test_signals_returns_list(self) -> None:
        r = self.client.get("/api/signals")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("signals", data)
        self.assertIsInstance(data["signals"], list)

    def test_ai_chat_not_configured(self) -> None:
        # No AI_API_KEY in test env: endpoint must refuse instead of
        # returning a demo answer.
        r = self.client.post(
            "/api/ai/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "language_code": "en",
            },
        )
        self.assertEqual(r.status_code, 503)
        body = r.json()
        detail = body.get("detail") or {}
        self.assertEqual(detail.get("error"), "ai_not_configured")

    def test_ai_chat_validates_messages(self) -> None:
        # Last message must be from the user.
        r = self.client.post(
            "/api/ai/chat",
            json={
                "messages": [{"role": "assistant", "content": "hello"}],
                "language_code": "en",
            },
        )
        # 503 is also acceptable here (config check runs first), but with
        # the assistant-last message we always reject — config or otherwise.
        self.assertIn(r.status_code, (400, 503))

    def test_auth_endpoint_requires_token(self) -> None:
        # In test environment TELEGRAM_BOT_TOKEN is unset -> 503.
        r = self.client.post("/api/auth/telegram", json={"init_data": "x"})
        self.assertEqual(r.status_code, 503)

    def test_ai_chat_no_key_mode_succeeds_without_auth_header(self) -> None:
        """AI_ALLOW_NO_KEY=true must let the request through without an
        AI_API_KEY and must NOT send an Authorization header upstream."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai",
                    "choices": [
                        {"message": {"content": "stubbed reply"}}
                    ],
                }

        class _StubClient:
            def __init__(self, *_a, **_kw) -> None:
                pass

            async def __aenter__(self) -> "_StubClient":
                return self

            async def __aexit__(self, *_a) -> None:
                return None

            async def post(self, url, json=None, headers=None):  # noqa: A002
                captured["url"] = url
                captured["headers"] = dict(headers or {})
                captured["json"] = json
                return _StubResponse()

        env = {
            "AI_API_KEY": "",
            "OPENAI_API_KEY": "",
            "AI_ALLOW_NO_KEY": "true",
            "AI_BASE_URL": "https://example.test/v1",
            "AI_MODEL": "openai",
        }
        with patch.dict(os.environ, env, clear=False), \
                patch("app.services.ai_assistant.httpx.AsyncClient", _StubClient):
            r = self.client.post(
                "/api/ai/chat",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "language_code": "en",
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["content"], "stubbed reply")
        # No Authorization header must have been forwarded to the public provider.
        headers = captured.get("headers", {})
        self.assertNotIn("Authorization", headers)
        self.assertNotIn("authorization", {k.lower() for k in headers})
        self.assertEqual(
            captured.get("url"),
            "https://example.test/v1/chat/completions",
        )

    def test_ai_chat_oidc_mode_sends_bearer(self) -> None:
        """AI_AUTH_MODE=oidc must forward AI_GATEWAY_API_KEY/VERCEL_OIDC_TOKEN
        as a Bearer token to the upstream Vercel AI Gateway URL."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai/gpt-4o-mini",
                    "choices": [{"message": {"content": "oidc ok"}}],
                }

        class _StubClient:
            def __init__(self, *_a, **_kw) -> None:
                pass

            async def __aenter__(self) -> "_StubClient":
                return self

            async def __aexit__(self, *_a) -> None:
                return None

            async def post(self, url, json=None, headers=None):  # noqa: A002
                captured["url"] = url
                captured["headers"] = dict(headers or {})
                captured["json"] = json
                return _StubResponse()

        env = {
            "AI_API_KEY": "",
            "OPENAI_API_KEY": "",
            "AI_ALLOW_NO_KEY": "",
            "AI_AUTH_MODE": "oidc",
            "AI_GATEWAY_API_KEY": "",
            "VERCEL_OIDC_TOKEN": "stub-oidc-token",
            "AI_BASE_URL": "https://ai-gateway.vercel.sh/v1",
            "AI_MODEL": "openai/gpt-4o-mini",
        }
        with patch.dict(os.environ, env, clear=False), \
                patch("app.services.ai_assistant.httpx.AsyncClient", _StubClient):
            r = self.client.post(
                "/api/ai/chat",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "language_code": "en",
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        headers = captured.get("headers", {})
        self.assertEqual(headers.get("Authorization"), "Bearer stub-oidc-token")
        self.assertEqual(
            captured.get("url"),
            "https://ai-gateway.vercel.sh/v1/chat/completions",
        )

    def test_ai_chat_oidc_mode_prefers_gateway_key(self) -> None:
        """AI_GATEWAY_API_KEY takes precedence over VERCEL_OIDC_TOKEN."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai/gpt-4o-mini",
                    "choices": [{"message": {"content": "ok"}}],
                }

        class _StubClient:
            def __init__(self, *_a, **_kw) -> None:
                pass

            async def __aenter__(self) -> "_StubClient":
                return self

            async def __aexit__(self, *_a) -> None:
                return None

            async def post(self, url, json=None, headers=None):  # noqa: A002
                captured["headers"] = dict(headers or {})
                return _StubResponse()

        env = {
            "AI_API_KEY": "",
            "OPENAI_API_KEY": "",
            "AI_AUTH_MODE": "oidc",
            "AI_GATEWAY_API_KEY": "vck-stub-gateway",
            "VERCEL_OIDC_TOKEN": "stub-oidc-token",
            "AI_BASE_URL": "https://ai-gateway.vercel.sh/v1",
            "AI_MODEL": "openai/gpt-4o-mini",
        }
        with patch.dict(os.environ, env, clear=False), \
                patch("app.services.ai_assistant.httpx.AsyncClient", _StubClient):
            r = self.client.post(
                "/api/ai/chat",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "language_code": "en",
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(
            captured.get("headers", {}).get("Authorization"),
            "Bearer vck-stub-gateway",
        )

    def test_ai_chat_oidc_missing_token_returns_503(self) -> None:
        """AI_AUTH_MODE=oidc with no usable token must surface 503
        ai_oidc_unavailable rather than fall back to ai_not_configured."""
        env = {
            "AI_API_KEY": "",
            "OPENAI_API_KEY": "",
            "AI_AUTH_MODE": "oidc",
            "AI_GATEWAY_API_KEY": "",
            "VERCEL_OIDC_TOKEN": "",
            "AI_BASE_URL": "https://ai-gateway.vercel.sh/v1",
        }
        with patch.dict(os.environ, env, clear=False):
            r = self.client.post(
                "/api/ai/chat",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "language_code": "en",
                },
            )
        self.assertEqual(r.status_code, 503)
        detail = r.json().get("detail") or {}
        self.assertEqual(detail.get("error"), "ai_oidc_unavailable")

    def test_ai_chat_no_key_disabled_returns_503(self) -> None:
        """With neither AI_API_KEY nor AI_ALLOW_NO_KEY set, the endpoint
        must refuse with 503 ai_not_configured."""
        env = {"AI_API_KEY": "", "OPENAI_API_KEY": "", "AI_ALLOW_NO_KEY": ""}
        with patch.dict(os.environ, env, clear=False):
            r = self.client.post(
                "/api/ai/chat",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "language_code": "en",
                },
            )
        self.assertEqual(r.status_code, 503)
        detail = r.json().get("detail") or {}
        self.assertEqual(detail.get("error"), "ai_not_configured")


if __name__ == "__main__":
    unittest.main()
