"""FastAPI app entry point.

Run locally:
    uvicorn app.main:app --reload --port 8000

On Railway/VPS:
    uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.config import settings
from app.routers import ai, auth, health, market, signals, ws

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("quantsignal")


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    log.info(
        "Starting %s v%s env=%s telegram=%s ai=%s",
        settings.app_name,
        __version__,
        settings.environment,
        settings.telegram_enabled,
        settings.ai_enabled,
    )
    yield
    log.info("Shutting down")
    await ws.shutdown_bus()


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(market.router)
app.include_router(signals.router)
app.include_router(ai.router)
app.include_router(ws.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "name": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "health": "/health",
    }
