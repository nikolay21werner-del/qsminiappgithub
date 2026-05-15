"""AI assistant endpoints."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.core.telegram_auth import TelegramAuthError, validate_init_data
from app.schemas.api import ChatRequest, ChatResponse
from app.services.ai_assistant import (
    ChatMessage,
    chat as chat_service,
    voice_placeholder,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


def _maybe_check_init_data(init_data: str | None) -> None:
    """Validate initData *only* if a bot token is configured.

    Running without a bot token keeps the scaffold usable for local
    development; once a token is wired in production, every authenticated
    endpoint enforces validation.
    """
    if not settings.telegram_enabled:
        return
    if not init_data:
        raise HTTPException(status_code=401, detail="initData required")
    try:
        validate_init_data(
            init_data,
            settings.telegram_bot_token,
            max_age_seconds=settings.telegram_init_data_max_age,
        )
    except TelegramAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    _maybe_check_init_data(req.init_data)
    reply = await chat_service(
        [ChatMessage(role=m.role, content=m.content) for m in req.messages],
        language_code=req.language_code,
    )
    return ChatResponse(
        content=reply.content,
        model=reply.model,
        mock=reply.mock,
        ts=reply.ts,
    )


@router.post("/voice", response_model=ChatResponse)
async def voice() -> ChatResponse:
    """Placeholder voice endpoint – returns the mock reply.

    To enable real voice: accept a multipart audio upload, transcribe with
    Whisper or an equivalent STT service, then forward the transcript to
    ``chat_service``.
    """
    reply = await voice_placeholder()
    return ChatResponse(
        content=reply.content,
        model=reply.model,
        mock=reply.mock,
        ts=reply.ts,
    )
