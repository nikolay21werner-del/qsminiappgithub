"""Market data routes – Bybit-first, demo fallback."""
from __future__ import annotations

import logging
import time
from typing import List, Optional

from fastapi import APIRouter, Query

from app.core.config import settings
from app.schemas.api import (
    KlineOut,
    KlineResponse,
    TickerOut,
    TickersResponse,
)
from app.services.bybit import BybitClient, demo_tickers

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/market", tags=["market"])

_client = BybitClient()


def _ticker_to_out(t) -> TickerOut:
    return TickerOut(
        symbol=t.symbol,
        last_price=t.last_price,
        change_pct_24h=t.change_pct_24h,
        volume_24h=t.volume_24h,
        high_24h=t.high_24h,
        low_24h=t.low_24h,
    )


@router.get("/tickers", response_model=TickersResponse)
async def tickers(
    symbols: Optional[str] = Query(
        default=None,
        description="Comma-separated list. Defaults to MARKET_SYMBOLS env.",
    ),
) -> TickersResponse:
    syms: List[str] = (
        [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if symbols
        else settings.market_default_symbols
    )
    try:
        rows = await _client.get_tickers(syms)
        if rows:
            return TickersResponse(
                source="bybit",
                ts=int(time.time() * 1000),
                tickers=[_ticker_to_out(t) for t in rows],
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("Bybit tickers unavailable, returning demo: %s", exc)
    return TickersResponse(
        source="demo",
        ts=int(time.time() * 1000),
        tickers=[_ticker_to_out(t) for t in demo_tickers(syms)],
    )


@router.get("/kline", response_model=KlineResponse)
async def kline(
    symbol: str = Query(..., min_length=3, max_length=20),
    interval: str = Query("60", description="Bybit interval string (1, 5, 15, 60, 240, D, W, M)"),
    limit: int = Query(200, ge=1, le=1000),
) -> KlineResponse:
    symbol = symbol.upper()
    try:
        candles = await _client.get_kline(symbol, interval=interval, limit=limit)
    except Exception as exc:  # noqa: BLE001
        log.warning("Bybit kline unavailable for %s: %s", symbol, exc)
        candles = []
    return KlineResponse(
        symbol=symbol,
        interval=interval,
        candles=[KlineOut(**c) for c in candles],
    )


@router.get("/orderbook")
async def orderbook(
    symbol: str = Query(..., min_length=3, max_length=20),
    depth: int = Query(50, ge=1, le=200),
):
    symbol = symbol.upper()
    try:
        return await _client.get_orderbook(symbol, depth=depth)
    except Exception as exc:  # noqa: BLE001
        log.warning("Bybit orderbook unavailable for %s: %s", symbol, exc)
        return {"symbol": symbol, "bids": [], "asks": [], "ts": None, "error": "unavailable"}
