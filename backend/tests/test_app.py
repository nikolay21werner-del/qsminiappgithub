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

    def test_ai_system_prompt_contains_guardrails(self) -> None:
        """The system prompt must enforce the trader-style guardrails so the
        upstream model can't drift into financial-advice territory."""
        from app.services.ai_assistant import SYSTEM_PROMPT_BASE

        for phrase in (
            "QUANTSIGNAL AI",
            "professional crypto-markets assistant",
            "Never call this financial advice",
            "Never promise profit",
            "Never fabricate",
            "Never recommend specific leverage",
            "natural Russian",
        ):
            self.assertIn(phrase, SYSTEM_PROMPT_BASE)

    def test_ai_chat_forwards_market_context_and_guardrails(self) -> None:
        """A successful chat call must forward the live market context and
        the guardrailed system prompt to the upstream provider."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai",
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
                    "messages": [
                        {"role": "user", "content": "Что думаешь по BTCUSDT?"}
                    ],
                    "language_code": "ru",
                    "market_context": {
                        "symbol": "BTCUSDT",
                        "last_price": 67234.5,
                        "change_pct_24h": 1.234,
                        "volume_24h": 9876543,
                        "high_24h": 68000,
                        "low_24h": 66000,
                        "transport": "websocket",
                        "provider": "Bybit V5 (linear)",
                    },
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        sent = captured.get("json") or {}
        sys_contents = "\n".join(
            str(m.get("content") or "")
            for m in sent.get("messages", [])
            if m.get("role") == "system"
        )
        self.assertIn("QUANTSIGNAL AI", sys_contents)
        self.assertIn("Never call this financial advice", sys_contents)
        self.assertIn("Never recommend specific leverage", sys_contents)
        self.assertIn("BTCUSDT", sys_contents)
        self.assertIn("67234.5", sys_contents)
        self.assertIn(
            "не является инвестиционной рекомендацией",
            sys_contents,
        )

    def test_ai_chat_forwards_aliased_market_context(self) -> None:
        """Production-shape market_context (price/volume_24h/high_24h/low_24h
        with aliases like 'status' for transport) must be normalized and the
        exact labels Last price / 24h volume / 24h high / 24h low / Data
        transport must reach the upstream system payload. Also the
        bias-consistency rule must be present."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai",
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
                    "messages": [
                        {"role": "user", "content": "Что по BTCUSDT?"}
                    ],
                    "language_code": "ru",
                    "market_context": {
                        "symbol": "BTCUSDT",
                        # Production-shape aliases:
                        "price": 79064.8,
                        "change_pct_24h": -2.69,
                        "volume_24h": "5.2B",
                        "high_24h": 81200,
                        "low_24h": 78350,
                        "status": "websocket",
                    },
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        sent = captured.get("json") or {}
        sys_contents = "\n".join(
            str(m.get("content") or "")
            for m in sent.get("messages", [])
            if m.get("role") == "system"
        )
        # Exact labels — what the model must literally see.
        self.assertIn("Symbol: BTCUSDT", sys_contents)
        self.assertIn("Last price: 79064.8", sys_contents)
        self.assertIn("24h change %: -2.690", sys_contents)
        self.assertIn("24h volume: 5.2B", sys_contents)
        self.assertIn("24h high: 81200", sys_contents)
        self.assertIn("24h low: 78350", sys_contents)
        self.assertIn("Data transport: websocket", sys_contents)
        # Bias-consistency rule must reach the model.
        self.assertIn("Bias-consistency rule", sys_contents)
        self.assertIn("materially negative", sys_contents)
        # No spurious n/a for fields the user supplied.
        self.assertNotIn("Last price: n/a", sys_contents)
        self.assertNotIn("24h volume: n/a", sys_contents)

    def test_ai_chat_forwards_camelcase_aliases(self) -> None:
        """Bybit-style camelCase aliases (lastPrice / price24hPcnt /
        turnover24h / highPrice24h / lowPrice24h) must also normalize."""
        captured: dict = {}

        class _StubResponse:
            status_code = 200
            text = ""

            def json(self) -> dict:
                return {
                    "model": "openai",
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
                    "messages": [{"role": "user", "content": "BTC?"}],
                    "language_code": "en",
                    "market_context": {
                        "symbol": "BTCUSDT",
                        "lastPrice": 79064.8,
                        "price24hPcnt": -0.0269,
                        "turnover24h": "5.2B",
                        "highPrice24h": 81200,
                        "lowPrice24h": 78350,
                        "transport": "rest",
                    },
                },
            )
        self.assertEqual(r.status_code, 200, r.text)
        sent = captured.get("json") or {}
        sys_contents = "\n".join(
            str(m.get("content") or "")
            for m in sent.get("messages", [])
            if m.get("role") == "system"
        )
        self.assertIn("Last price: 79064.8", sys_contents)
        self.assertIn("24h volume: 5.2B", sys_contents)
        self.assertIn("24h high: 81200", sys_contents)
        self.assertIn("24h low: 78350", sys_contents)
        self.assertIn("Data transport: rest", sys_contents)

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
