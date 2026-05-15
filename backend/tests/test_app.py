"""Smoke tests for the FastAPI app – run with stdlib unittest."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

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

    def test_ai_chat_mock(self) -> None:
        r = self.client.post(
            "/api/ai/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "language_code": "en",
            },
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["mock"])  # no OPENAI key in tests
        self.assertGreater(len(data["content"]), 0)

    def test_auth_endpoint_requires_token(self) -> None:
        # In test environment TELEGRAM_BOT_TOKEN is unset -> 503.
        r = self.client.post("/api/auth/telegram", json={"init_data": "x"})
        self.assertEqual(r.status_code, 503)


if __name__ == "__main__":
    unittest.main()
