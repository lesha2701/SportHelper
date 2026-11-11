from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings_dep
from app.config import Settings
from app.core.client_version import PLATFORMS, is_older, parse_version, platform_of
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
        "trainer_balance": settings.trainer_balance_enabled,
        "trainer_withdrawals": settings.trainer_balance_enabled and settings.trainer_withdrawals_enabled,
    }


@router.get("/app-config")
async def app_config(request: Request, settings: Settings = Depends(get_settings_dep)) -> dict:
    """What a mobile app reads when it starts (and after a 426): the minimum version it may run, the latest one and where to update.
    Public and never refused for an old version. When the app says who it is (X-Client-Platform, X-Client-Version), `client` also answers
    for it: `update_required` (the server will refuse it) and `update_available` (a newer version exists; offering it is up to the app)."""
    platforms: dict[str, dict] = {}
    for name in PLATFORMS:
        minimum, latest, url = settings.client_policy(name)
        platforms[name] = {"min_version": minimum or None, "latest_version": latest or None, "update_url": url or None}

    client: dict | None = None
    platform = platform_of(request.headers.get("x-client-platform"))
    if platform:
        version = parse_version(request.headers.get("x-client-version"))
        minimum = parse_version(platforms[platform]["min_version"])
        latest = parse_version(platforms[platform]["latest_version"])
        client = {
            "platform": platform,
            "version": request.headers.get("x-client-version"),
            "update_required": bool(version is not None and minimum is not None and is_older(version, minimum)),
            "update_available": bool(version is not None and latest is not None and is_older(version, latest)),
        }
    # api_version: raised only for a change an old app cannot survive (the minimum versions above are the lever; this tells which API it faces).
    return {"api_version": 1, "platforms": platforms, "client": client}
