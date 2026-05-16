"""AI assistant service – OpenAI-compatible LLM proxy.

The frontend calls ``/api/ai/chat`` with a list of messages and an optional
live market context block. The backend forwards the conversation to an
OpenAI-compatible provider configured via environment variables.

There is **no** demo/mock fallback. If the provider is not configured or the
upstream call fails, we raise so the router can surface a clear error to the
client — the UI is responsible for telling the user that the AI backend is
not configured, not for pretending to be an AI.

Voice transcription is not yet implemented; ``voice_placeholder`` raises
``AIError("voice_not_implemented")``.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


class AIError(RuntimeError):
    """Raised for any AI-related failure (config, upstream, validation)."""

    def __init__(self, code: str, message: str = "", status: int = 502) -> None:
        super().__init__(message or code)
        self.code = code
        self.status = status


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


@dataclass
class ChatReply:
    content: str
    model: str
    ts: int


SYSTEM_PROMPT_BASE = (
    "You are QUANTSIGNAL AI, a concise crypto-markets analyst integrated into a "
    "Telegram Mini App. You receive live market context (selected symbol, last "
    "price, 24h change, 24h volume, 24h high/low, connection status) and the "
    "user's recent conversation.\n\n"
    "Rules:\n"
    "- Respond in the user's language (en/ru/zh) matching `language_code`.\n"
    "- Ground every observation in the provided live context. If a field is "
    "missing, say so plainly instead of inventing values.\n"
    "- Be objective and structured: trend, key levels, volatility/volume context, "
    "invalidation, and what would change your view. Use short bullets.\n"
    "- NEVER claim to give financial advice. Always include a short risk caveat "
    "at the end (one sentence) in the user's language.\n"
    "- Do not promise outcomes, do not use hype words, do not output emojis.\n"
    "- Keep replies under ~220 words."
)


RISK_CAVEAT = {
    "en": "Educational analysis based on live market data — not financial advice. Manage risk.",
    "ru": "Аналитика по живым рыночным данным — не является инвестиционной рекомендацией. Управляйте риском.",
    "zh": "基于实时行情的研究性分析 — 不构成投资建议，请控制风险。",
}


def _pick_lang(code: Optional[str]) -> str:
    if not code:
        return "en"
    lc = code.lower()
    if lc.startswith("ru"):
        return "ru"
    if lc.startswith("zh"):
        return "zh"
    return "en"


def _sanitize_symbol(sym: Any) -> str:
    if not sym:
        return ""
    out = "".join(
        ch for ch in str(sym).upper()
        if ch.isalnum() or ch in {".", "_", "-"}
    )
    return out[:20]


def _num(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return n


def _build_market_context(ctx: Optional[Mapping[str, Any]], lang: str) -> Optional[str]:
    if not ctx or not isinstance(ctx, Mapping):
        return None
    symbol = _sanitize_symbol(ctx.get("symbol"))
    if not symbol:
        return None
    last = _num(ctx.get("last_price"))
    change = _num(ctx.get("change_pct_24h"))
    volume = _num(ctx.get("volume_24h"))
    high = _num(ctx.get("high_24h"))
    low = _num(ctx.get("low_24h"))
    transport = str(ctx.get("transport") or "unknown")[:16]
    provider = str(ctx.get("provider") or "Bybit V5 (linear)")[:64]
    age_ms = _num(ctx.get("last_update_age_ms"))

    lines = [
        f"Symbol: {symbol}",
        f"Last price: {'n/a' if last is None else last}",
        f"24h change %: {'n/a' if change is None else f'{change:.3f}'}",
        f"24h volume (quote): {'n/a' if volume is None else volume}",
        f"24h high: {'n/a' if high is None else high}",
        f"24h low: {'n/a' if low is None else low}",
        f"Connection: {transport} via {provider}"
        + (f" (last tick {int(age_ms)}ms ago)" if age_ms is not None else ""),
    ]
    peers_raw = ctx.get("top_tickers")
    if isinstance(peers_raw, list) and peers_raw:
        peers = []
        for t in peers_raw[:8]:
            if not isinstance(t, Mapping):
                continue
            s = _sanitize_symbol(t.get("symbol"))
            if not s:
                continue
            p = _num(t.get("last_price"))
            c = _num(t.get("change_pct_24h"))
            peers.append(
                f"{s} {'n/a' if p is None else p}"
                f" ({'n/a' if c is None else f'{c:.2f}%'})"
            )
        if peers:
            lines.append("Peers: " + ", ".join(peers))

    return f"## LIVE MARKET CONTEXT (language={lang})\n" + "\n".join(lines)


def _provider_settings() -> Dict[str, Any]:
    """Resolve AI provider env. Preferred: AI_API_KEY/AI_BASE_URL/AI_MODEL.

    Falls back to the legacy OPENAI_* env vars on the Settings object so
    existing deployments continue to work without re-configuration.

    ``allow_no_key`` indicates that the provider accepts unauthenticated
    requests (e.g. https://gen.pollinations.ai/v1). When true, the
    Authorization header is omitted entirely from the upstream request.

    ``oidc_mode`` indicates the Vercel AI Gateway path: the bearer token
    comes from AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, not AI_API_KEY.
    """
    import os

    api_key = os.getenv("AI_API_KEY") or settings.openai_api_key
    base_url = (os.getenv("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("AI_MODEL") or settings.openai_model
    provider_alias = (os.getenv("AI_PROVIDER") or "").lower()
    auth_mode = (os.getenv("AI_AUTH_MODE") or "").lower()
    if not auth_mode and provider_alias == "vercel-ai-gateway":
        auth_mode = "oidc"
    allow_flag = (os.getenv("AI_ALLOW_NO_KEY") or "").lower()
    allow_no_key = (
        auth_mode == "none"
        or allow_flag in {"1", "true", "yes"}
        or settings.ai_allow_no_key
    )
    oidc_mode = auth_mode == "oidc"
    oidc_token = os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN") or ""
    return {
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "allow_no_key": allow_no_key,
        "oidc_mode": oidc_mode,
        "oidc_token": oidc_token,
    }


async def chat(
    messages: List[ChatMessage],
    language_code: Optional[str] = None,
    market_context: Optional[Mapping[str, Any]] = None,
) -> ChatReply:
    if not messages:
        raise AIError("messages_empty", "No messages provided.", status=400)
    if messages[-1].role != "user":
        raise AIError("last_message_not_user", "Last message must be from the user.", status=400)

    cfg = _provider_settings()
    if cfg["oidc_mode"] and not cfg["oidc_token"]:
        raise AIError(
            "ai_oidc_unavailable",
            "AI_AUTH_MODE=oidc is set but neither AI_GATEWAY_API_KEY nor "
            "VERCEL_OIDC_TOKEN is available.",
            status=503,
        )
    if not cfg["api_key"] and not cfg["allow_no_key"] and not cfg["oidc_mode"]:
        raise AIError(
            "ai_not_configured",
            "Server-side AI key (AI_API_KEY) is not configured.",
            status=503,
        )

    lang = _pick_lang(language_code)
    system_blocks: List[Dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT_BASE}]
    market_block = _build_market_context(market_context, lang)
    if market_block:
        system_blocks.append({"role": "system", "content": market_block})
    system_blocks.append({
        "role": "system",
        "content": f'Always end with this exact risk caveat on its own line: "{RISK_CAVEAT[lang]}"',
    })

    payload = {
        "model": cfg["model"],
        "messages": system_blocks + [{"role": m.role, "content": m.content} for m in messages],
        "temperature": 0.2,
        "max_tokens": 600,
    }
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if cfg["oidc_mode"]:
        headers["Authorization"] = f"Bearer {cfg['oidc_token']}"
    elif cfg["api_key"] and not cfg["allow_no_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    elif cfg["api_key"] and cfg["allow_no_key"]:
        # Explicit no-key mode: do NOT send Authorization even if a stub
        # key happens to be set. This matches public providers that
        # reject any Authorization header (e.g. Pollinations).
        pass
    ts = int(time.time() * 1000)
    url = f"{cfg['base_url']}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise AIError("ai_upstream_timeout", "Upstream provider timed out.", status=504) from exc
    except httpx.HTTPError as exc:
        raise AIError("ai_upstream_unreachable", "Could not reach upstream provider.", status=504) from exc

    if resp.status_code >= 400:
        detail = resp.text[:400] if resp.text else None
        raise AIError(
            "ai_upstream_error",
            detail or f"Upstream HTTP {resp.status_code}",
            status=502,
        )

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIError("ai_upstream_bad_json", "Malformed upstream response.", status=502) from exc

    if not content:
        raise AIError("ai_empty_response", "Provider returned an empty reply.", status=502)

    return ChatReply(content=str(content), model=str(data.get("model") or cfg["model"]), ts=ts)


async def voice_placeholder(language_code: Optional[str] = None) -> ChatReply:
    """Voice is not implemented yet. Raise so the API surface is honest."""
    raise AIError(
        "voice_not_implemented",
        "Voice transcription is not implemented on this deployment.",
        status=501,
    )
