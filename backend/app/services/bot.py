"""Telegram bot alerts module (skeleton).

This module is intentionally tiny – it exposes ``send_message`` which only
operates when ``TELEGRAM_BOT_TOKEN`` is configured. It is meant to be wired
into the signal engine later (e.g. push a Telegram alert when a new high-
confidence signal appears) without forcing every developer to provision a
bot just to run the API.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


async def send_message(
    chat_id: int | str,
    text: str,
    parse_mode: Optional[str] = "HTML",
    disable_web_page_preview: bool = True,
) -> bool:
    """Send a plain Telegram message. Returns True on success.

    No-op (returns False) if TELEGRAM_BOT_TOKEN is not configured.
    """
    if not settings.telegram_enabled:
        log.info("bot.send_message skipped: TELEGRAM_BOT_TOKEN not set")
        return False
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            ok = bool(data.get("ok"))
            if not ok:
                log.warning("Telegram sendMessage failed: %s", data)
            return ok
    except Exception as exc:  # noqa: BLE001
        log.warning("Telegram sendMessage exception: %s", exc)
        return False
