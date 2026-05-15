"""Signal engine.

The current implementation is intentionally deterministic – it produces
demo-quality signals from the latest ticker snapshot so the frontend has
something to render even on a cold start. The shape of `Signal` is stable so
that swapping in a real strategy later is a drop-in replacement.

A real strategy module should implement the `SignalStrategy.evaluate`
interface and yield `Signal` instances.
"""
from __future__ import annotations

import logging
import math
import random
import time
from dataclasses import asdict, dataclass, field
from typing import List, Literal, Optional, Protocol

from app.services.bybit import Ticker, BybitClient, demo_tickers
from app.core.config import settings

log = logging.getLogger(__name__)

Direction = Literal["LONG", "SHORT"]


@dataclass
class Signal:
    id: str
    symbol: str
    direction: Direction
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    confidence: float            # 0..1
    risk_reward: float           # R multiple of TP1 vs SL
    rationale: str
    ts: int = field(default_factory=lambda: int(time.time() * 1000))


class SignalStrategy(Protocol):
    name: str

    async def evaluate(self, tickers: List[Ticker]) -> List[Signal]: ...


class MomentumDemoStrategy:
    """Deterministic demo strategy.

    For each ticker we generate a signal using the 24h-change as a momentum
    proxy. This is *not* trading advice – it exists purely so the UI has
    realistic-looking placeholders until a real strategy is wired up.
    """

    name = "momentum-demo-v1"

    async def evaluate(self, tickers: List[Ticker]) -> List[Signal]:
        out: List[Signal] = []
        for t in tickers:
            if t.last_price <= 0:
                continue
            mom = t.change_pct_24h
            direction: Direction = "LONG" if mom >= 0 else "SHORT"
            # Stops/targets scaled by recent realized range.
            range_pct = max(0.005, abs(mom) / 100 + 0.01)
            if direction == "LONG":
                entry = t.last_price
                sl = entry * (1 - range_pct * 1.2)
                tp1 = entry * (1 + range_pct * 1.0)
                tp2 = entry * (1 + range_pct * 2.0)
            else:
                entry = t.last_price
                sl = entry * (1 + range_pct * 1.2)
                tp1 = entry * (1 - range_pct * 1.0)
                tp2 = entry * (1 - range_pct * 2.0)
            rr = abs(tp1 - entry) / max(abs(entry - sl), 1e-9)
            conf = min(0.95, 0.45 + abs(mom) / 20)  # cap at 95%
            out.append(
                Signal(
                    id=f"{t.symbol}-{int(time.time())}",
                    symbol=t.symbol,
                    direction=direction,
                    entry=round(entry, 6),
                    stop_loss=round(sl, 6),
                    take_profit_1=round(tp1, 6),
                    take_profit_2=round(tp2, 6),
                    confidence=round(conf, 3),
                    risk_reward=round(rr, 2),
                    rationale=(
                        f"24h momentum {mom:+.2f}% on {t.symbol}; "
                        f"range-scaled targets, demo strategy."
                    ),
                )
            )
        return out


class SignalEngine:
    """Aggregates one or more strategies and produces the current signal list."""

    def __init__(self, strategy: Optional[SignalStrategy] = None) -> None:
        self.strategy: SignalStrategy = strategy or MomentumDemoStrategy()
        self._client = BybitClient()

    async def latest(self, symbols: Optional[List[str]] = None) -> List[Signal]:
        symbols = symbols or settings.market_default_symbols
        try:
            tickers = await self._client.get_tickers(symbols)
            if not tickers:
                tickers = demo_tickers(symbols)
        except Exception as exc:  # noqa: BLE001
            log.warning("SignalEngine falling back to demo tickers: %s", exc)
            tickers = demo_tickers(symbols)
        return await self.strategy.evaluate(tickers)

    async def close(self) -> None:
        await self._client.close()


def signal_to_dict(s: Signal) -> dict:
    return asdict(s)
