"""Runtime configuration loaded from environment variables.

No third-party config library is required – we keep the surface area small so
that the project starts cleanly on Railway, Fly.io or a plain VPS with `pip
install -r requirements.txt && uvicorn app.main:app`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _split_csv(value: str | None) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # --- App ---
    app_name: str = os.getenv("APP_NAME", "QUANTSIGNAL AI Backend")
    environment: str = os.getenv("ENVIRONMENT", "development")
    debug: bool = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes"}
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))

    # --- CORS ---
    # Comma-separated list of origins; defaults are permissive for development.
    cors_origins: List[str] = field(
        default_factory=lambda: _split_csv(os.getenv("CORS_ORIGINS"))
        or ["*"]
    )

    # --- Telegram ---
    telegram_bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_init_data_max_age: int = int(
        os.getenv("TELEGRAM_INIT_DATA_MAX_AGE", "86400")
    )  # 24h default

    # --- Bybit (public market data, no key required) ---
    bybit_rest_base: str = os.getenv(
        "BYBIT_REST_BASE", "https://api.bybit.com"
    )
    bybit_ws_public: str = os.getenv(
        "BYBIT_WS_PUBLIC", "wss://stream.bybit.com/v5/public/linear"
    )
    bybit_category: str = os.getenv("BYBIT_CATEGORY", "linear")  # linear|spot|inverse

    # --- AI assistant (optional) ---
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # --- Misc ---
    market_default_symbols: List[str] = field(
        default_factory=lambda: _split_csv(os.getenv("MARKET_SYMBOLS"))
        or ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "TONUSDT", "XRPUSDT"]
    )

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openai_api_key)


settings = Settings()
