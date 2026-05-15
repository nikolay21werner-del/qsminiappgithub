"""Bybit V5 public market-data client.

We rely *only* on public endpoints – no API key is required. The service is
designed so that the rest of the application interacts with a thin async
facade; the underlying HTTP/WebSocket transport can later be swapped without
touching callers.

Bybit V5 public REST endpoints used:
  GET /v5/market/tickers     – latest ticker snapshot
  GET /v5/market/kline       – historical candles
  GET /v5/market/orderbook   – L2 depth

Public WebSocket topics (`tickers.<symbol>`, `kline.<interval>.<symbol>`,
`orderbook.<depth>.<symbol>`) are streamed via `wss://stream.bybit.com/v5/public/<category>`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


@dataclass
class Ticker:
    symbol: str
    last_price: float
    change_pct_24h: float
    volume_24h: float
    high_24h: float
    low_24h: float


class BybitClient:
    """Thin async wrapper over Bybit V5 public REST."""

    def __init__(
        self,
        base_url: str | None = None,
        category: str | None = None,
        timeout: float = 5.0,
    ) -> None:
        self.base_url = (base_url or settings.bybit_rest_base).rstrip("/")
        self.category = category or settings.bybit_category
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _get(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        client = await self._http()
        url = f"{self.base_url}{path}"
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") not in (0, None):
            raise RuntimeError(f"Bybit error: {data.get('retMsg')} ({data.get('retCode')})")
        return data.get("result", {})

    # --- public endpoints ---

    async def get_tickers(self, symbols: Optional[List[str]] = None) -> List[Ticker]:
        result = await self._get(
            "/v5/market/tickers", {"category": self.category}
        )
        rows: List[Dict[str, Any]] = result.get("list", [])
        wanted = set(symbols or [])
        tickers: List[Ticker] = []
        for r in rows:
            sym = r.get("symbol")
            if wanted and sym not in wanted:
                continue
            try:
                tickers.append(
                    Ticker(
                        symbol=sym,
                        last_price=float(r.get("lastPrice") or 0),
                        change_pct_24h=float(r.get("price24hPcnt") or 0) * 100.0,
                        volume_24h=float(r.get("turnover24h") or 0),
                        high_24h=float(r.get("highPrice24h") or 0),
                        low_24h=float(r.get("lowPrice24h") or 0),
                    )
                )
            except (TypeError, ValueError):
                continue
        return tickers

    async def get_kline(
        self,
        symbol: str,
        interval: str = "60",
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        result = await self._get(
            "/v5/market/kline",
            {
                "category": self.category,
                "symbol": symbol,
                "interval": interval,
                "limit": min(limit, 1000),
            },
        )
        # Bybit returns newest first; reverse so callers receive chronological order.
        raw = list(reversed(result.get("list", [])))
        candles: List[Dict[str, Any]] = []
        for row in raw:
            try:
                candles.append(
                    {
                        "ts": int(row[0]),
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": float(row[5]),
                    }
                )
            except (IndexError, ValueError, TypeError):
                continue
        return candles

    async def get_orderbook(self, symbol: str, depth: int = 50) -> Dict[str, Any]:
        result = await self._get(
            "/v5/market/orderbook",
            {"category": self.category, "symbol": symbol, "limit": depth},
        )
        return {
            "symbol": symbol,
            "ts": result.get("ts"),
            "bids": [[float(p), float(q)] for p, q in result.get("b", [])],
            "asks": [[float(p), float(q)] for p, q in result.get("a", [])],
        }


# ---------- Demo fallback ----------

def demo_tickers(symbols: List[str]) -> List[Ticker]:
    """Deterministic-ish demo snapshot used when Bybit is unreachable."""
    rnd = random.Random(int(time.time()) // 30)  # rotate every 30 s
    out: List[Ticker] = []
    base = {
        "BTCUSDT": 67800,
        "ETHUSDT": 3510,
        "SOLUSDT": 184.0,
        "BNBUSDT": 612.0,
        "TONUSDT": 7.15,
        "XRPUSDT": 0.612,
        "DOGEUSDT": 0.158,
        "AVAXUSDT": 36.4,
    }
    for sym in symbols:
        p = base.get(sym, 100.0)
        drift = rnd.uniform(-0.03, 0.03)
        last = p * (1 + drift)
        out.append(
            Ticker(
                symbol=sym,
                last_price=round(last, 4),
                change_pct_24h=round(drift * 100.0, 2),
                volume_24h=round(rnd.uniform(1e6, 5e8), 2),
                high_24h=round(last * 1.02, 4),
                low_24h=round(last * 0.98, 4),
            )
        )
    return out


# ---------- WebSocket skeleton ----------

class BybitPublicWS:
    """Skeleton public WebSocket client.

    Connects to ``wss://stream.bybit.com/v5/public/<category>`` and subscribes
    to public topics. This is intentionally minimal – production deployments
    should add reconnect/backoff, ping/pong, and message buffering.
    """

    def __init__(self, url: str | None = None) -> None:
        self.url = url or settings.bybit_ws_public
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._subscribers: List[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    async def _broadcast(self, msg: Dict[str, Any]) -> None:
        dead: List[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    async def run(self, topics: List[str]) -> None:
        """Run loop – currently a placeholder that emits demo snapshots.

        Replace the inner ``await asyncio.sleep`` block with an actual
        ``websockets.connect`` session when productionizing.
        """
        log.info("BybitPublicWS placeholder running with topics=%s", topics)
        client = BybitClient()
        try:
            while not self._stop.is_set():
                try:
                    tickers = await client.get_tickers(settings.market_default_symbols)
                except Exception as exc:  # noqa: BLE001
                    log.warning("BybitPublicWS REST fallback failed: %s", exc)
                    tickers = demo_tickers(settings.market_default_symbols)
                await self._broadcast(
                    {
                        "type": "snapshot",
                        "ts": int(time.time() * 1000),
                        "tickers": [t.__dict__ for t in tickers],
                    }
                )
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
        finally:
            await client.close()

    def start(self, topics: List[str]) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self.run(topics))

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                self._task.cancel()
