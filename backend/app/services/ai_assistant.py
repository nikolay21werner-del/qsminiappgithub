"""AI assistant service – LLM-backed when configured, structured mock otherwise.

The frontend calls `/api/ai/chat` with a list of messages; the backend either
proxies to OpenAI (if `OPENAI_API_KEY` is set) or returns a deterministic
mock response that still has the production response shape.

`/api/ai/voice` is a placeholder for future speech-to-text + chat. It
currently always returns the mock.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import List, Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


@dataclass
class ChatReply:
    content: str
    model: str
    mock: bool
    ts: int


SYSTEM_PROMPT = (
    "You are QUANTSIGNAL AI, a concise crypto markets assistant. "
    "Answer in the user's language. Never give financial advice; provide "
    "objective context, risk caveats, and structured analysis."
)


_MOCK_REPLIES = {
    "en": (
        "Market context (demo): BTC trend is constructive on the 4h timeframe "
        "with volumes holding above the 20-period mean. Bias is cautiously "
        "bullish; invalidation below the prior swing low. Not financial advice."
    ),
    "ru": (
        "Контекст рынка (демо): BTC удерживает восходящую структуру на 4ч, "
        "объёмы выше 20-периодного среднего. Базовый сценарий — осторожно "
        "бычий; инвалидация ниже предыдущего минимума. Не является финансовой "
        "рекомендацией."
    ),
    "zh": (
        "市场背景（演示）：BTC 4 小时级别保持上行结构，成交量高于 20 周期均值。"
        "基本判断为谨慎看多；跌破前低则结构失效。本内容不构成投资建议。"
    ),
}


def _pick_mock(language_code: Optional[str]) -> str:
    if not language_code:
        return _MOCK_REPLIES["en"]
    lc = language_code.lower()
    if lc.startswith("ru"):
        return _MOCK_REPLIES["ru"]
    if lc.startswith("zh"):
        return _MOCK_REPLIES["zh"]
    return _MOCK_REPLIES["en"]


async def chat(
    messages: List[ChatMessage],
    language_code: Optional[str] = None,
) -> ChatReply:
    ts = int(time.time() * 1000)
    if not settings.ai_enabled:
        return ChatReply(
            content=_pick_mock(language_code),
            model="mock",
            mock=True,
            ts=ts,
        )

    payload = {
        "model": settings.openai_model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}]
        + [{"role": m.role, "content": m.content} for m in messages],
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return ChatReply(
                content=content,
                model=settings.openai_model,
                mock=False,
                ts=ts,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("AI provider call failed, returning mock: %s", exc)
        return ChatReply(
            content=_pick_mock(language_code),
            model="mock",
            mock=True,
            ts=ts,
        )


async def voice_placeholder(language_code: Optional[str] = None) -> ChatReply:
    """Voice endpoint placeholder.

    Will accept audio bytes once integrated with a Whisper-compatible STT and
    forward the transcript to `chat()`.
    """
    return ChatReply(
        content=_pick_mock(language_code),
        model="mock-voice",
        mock=True,
        ts=int(time.time() * 1000),
    )
