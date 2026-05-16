"""Pydantic request/response schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    name: str
    version: str
    environment: str
    telegram_enabled: bool
    ai_enabled: bool


class TickerOut(BaseModel):
    symbol: str
    last_price: float
    change_pct_24h: float
    volume_24h: float
    high_24h: float
    low_24h: float


class TickersResponse(BaseModel):
    source: Literal["bybit", "demo"]
    ts: int
    tickers: List[TickerOut]


class KlineOut(BaseModel):
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class KlineResponse(BaseModel):
    symbol: str
    interval: str
    candles: List[KlineOut]


class SignalOut(BaseModel):
    id: str
    symbol: str
    direction: Literal["LONG", "SHORT"]
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    confidence: float
    risk_reward: float
    rationale: str
    ts: int


class SignalsResponse(BaseModel):
    strategy: str
    signals: List[SignalOut]


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: List[ChatMessageIn] = Field(min_length=1, max_length=24)
    language_code: Optional[str] = None
    market_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Live market context (symbol, last_price, change_pct_24h, etc.).",
    )
    init_data: Optional[str] = Field(
        default=None,
        description="Telegram WebApp initData; required when bot token is configured.",
    )


class ChatResponse(BaseModel):
    content: str
    model: str
    ts: int


class VerifyInitDataRequest(BaseModel):
    init_data: str


class VerifyInitDataResponse(BaseModel):
    ok: bool
    user_id: Optional[int] = None
    language_code: Optional[str] = None
    auth_date: Optional[int] = None
