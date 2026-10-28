from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings_dep
from app.config import Settings
from app.database import check_connection

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    db_ok = await check_connection(request.app.state.db_pool)
    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
    }


@router.get("/features")
async def features(settings: Settings = Depends(get_settings_dep)) -> dict:
    """What the site should offer, decided by the server's .env alone (the page shows no Telegram
    options while TELEGRAM_ENABLED is off). Public: it holds no user data."""
    return {
        "telegram": settings.telegram_active and bool(settings.telegram_bot_username),
        "payments": settings.payments_enabled,
    }
