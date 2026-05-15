from fastapi import APIRouter

from app import __version__
from app.core.config import settings
from app.schemas.api import HealthResponse

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        name=settings.app_name,
        version=__version__,
        environment=settings.environment,
        telegram_enabled=settings.telegram_enabled,
        ai_enabled=settings.ai_enabled,
    )
