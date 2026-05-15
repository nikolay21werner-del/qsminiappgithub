from fastapi import APIRouter

from app.schemas.api import SignalOut, SignalsResponse
from app.services.signals import SignalEngine, signal_to_dict

router = APIRouter(prefix="/api/signals", tags=["signals"])
_engine = SignalEngine()


@router.get("", response_model=SignalsResponse)
async def list_signals() -> SignalsResponse:
    signals = await _engine.latest()
    return SignalsResponse(
        strategy=_engine.strategy.name,
        signals=[SignalOut(**signal_to_dict(s)) for s in signals],
    )
