"""WebSocket router – streams market snapshots to connected clients."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.bybit import BybitPublicWS

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])

# Single shared publisher across all connections to avoid hammering Bybit.
_bus = BybitPublicWS()


@router.websocket("/ws/market")
async def ws_market(ws: WebSocket) -> None:
    await ws.accept()
    queue = _bus.subscribe()
    # Lazy start.
    _bus.start(topics=["tickers"])
    try:
        # Send hello so clients can confirm connection.
        await ws.send_text(json.dumps({"type": "hello", "channel": "market"}))
        while True:
            msg = await queue.get()
            await ws.send_text(json.dumps(msg, default=str))
    except WebSocketDisconnect:
        log.debug("ws_market client disconnected")
    except Exception as exc:  # noqa: BLE001
        log.warning("ws_market error: %s", exc)
    finally:
        _bus.unsubscribe(queue)


async def shutdown_bus() -> None:
    await _bus.stop()
