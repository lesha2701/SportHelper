from __future__ import annotations

import logging
import secrets

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.repositories import login_tokens as login_tokens_repo
from app.repositories import users as users_repo
from app.schemas.auth import (
    AuthResponse,
    BrowserLoginPollOut,
    BrowserLoginPollRequest,
    BrowserLoginStartOut,
    TelegramAuthRequest,
)
from app.schemas.user import UserOut
from app.security.jwt import create_access_token
from app.security.telegram_auth import InvalidInitData, extract_user, verify_init_data

logger = logging.getLogger("teamflow.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/telegram", response_model=AuthResponse)
async def login_with_telegram(
    payload: TelegramAuthRequest,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthResponse:
    try:
        fields = verify_init_data(
            payload.init_data,
            settings.telegram_bot_token,
            settings.telegram_auth_max_age_seconds,
        )
        telegram_user = extract_user(fields)
    except InvalidInitData as exc:
        # Never log init_data itself: it contains the user's Telegram profile
        # and a signature; log only the failure reason.
        logger.warning("Telegram auth rejected: %s", exc)
        raise UnauthorizedError("invalid Telegram authentication data") from exc

    user = await users_repo.upsert_from_telegram(conn, telegram_user)

    if user["is_banned"]:
        raise ForbiddenError("user is banned")

    token = create_access_token(user["id"], settings)
    return AuthResponse(access_token=token, user=UserOut(**user))


BROWSER_LOGIN_TTL_SECONDS = 300


@router.post("/browser/start", response_model=BrowserLoginStartOut)
async def start_browser_login(
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> BrowserLoginStartOut:
    """Website login outside Telegram: returns a one-time token plus the bot
    link the user opens to confirm it (see bot/handlers/start.py)."""
    if not settings.telegram_bot_username:
        raise ForbiddenError("browser login is not configured")
    token = secrets.token_urlsafe(24)
    await login_tokens_repo.create(conn, token, BROWSER_LOGIN_TTL_SECONDS)
    return BrowserLoginStartOut(
        token=token,
        bot_url=f"https://t.me/{settings.telegram_bot_username}?start=login_{token}",
        expires_in=BROWSER_LOGIN_TTL_SECONDS,
    )


@router.post("/browser/poll", response_model=BrowserLoginPollOut)
async def poll_browser_login(
    payload: BrowserLoginPollRequest,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> BrowserLoginPollOut:
    user_id = await login_tokens_repo.consume(conn, payload.token)
    if user_id is None:
        pending = await login_tokens_repo.is_pending(conn, payload.token)
        return BrowserLoginPollOut(status="pending" if pending else "expired")

    user = await users_repo.get_by_id(conn, user_id)
    if user is None:
        return BrowserLoginPollOut(status="expired")
    if user["is_banned"]:
        raise ForbiddenError("user is banned")
    return BrowserLoginPollOut(
        status="ok",
        auth=AuthResponse(access_token=create_access_token(user["id"], settings), user=UserOut(**user)),
    )


@router.get("/me", response_model=UserOut)
async def get_me(user: dict = Depends(get_current_user)) -> UserOut:
    return UserOut(**user)
