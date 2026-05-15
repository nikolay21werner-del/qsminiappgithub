"""Telegram WebApp initData verification endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.core.telegram_auth import TelegramAuthError, validate_init_data
from app.schemas.api import VerifyInitDataRequest, VerifyInitDataResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/telegram", response_model=VerifyInitDataResponse)
async def verify(req: VerifyInitDataRequest) -> VerifyInitDataResponse:
    if not settings.telegram_enabled:
        # Surface a clear error so clients know the server is not yet wired.
        raise HTTPException(
            status_code=503,
            detail="Telegram bot token is not configured on the server",
        )
    try:
        v = validate_init_data(
            req.init_data,
            settings.telegram_bot_token,
            max_age_seconds=settings.telegram_init_data_max_age,
        )
    except TelegramAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return VerifyInitDataResponse(
        ok=True,
        user_id=v.user_id,
        language_code=v.language_code,
        auth_date=v.auth_date,
    )
