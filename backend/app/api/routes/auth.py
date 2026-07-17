from __future__ import annotations

import logging

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.repositories import users as users_repo
from app.schemas.auth import AuthResponse, TelegramAuthRequest
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


@router.get("/me", response_model=UserOut)
async def get_me(user: dict = Depends(get_current_user)) -> UserOut:
    return UserOut(**user)
