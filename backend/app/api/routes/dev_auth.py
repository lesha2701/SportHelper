"""Dev-only login shortcut.

Lets the frontend authenticate without a real Telegram client — needed to
open the Mini App directly in a regular browser during local development,
where `@tma.js/sdk`'s `isTMA()` is false and there's no real `initData` to
sign. Logs in as a fixed dev user, skipping Telegram signature verification
entirely.

This router is only registered by app/main.py when DEV_AUTH_ENABLED is true
(default off) — see app/config.py. Never enable that flag outside a
developer's own machine; see docs/dev-notes.md for why.
"""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_db, get_settings_dep
from app.config import Settings
from app.repositories import users as users_repo
from app.schemas.auth import AuthResponse
from app.schemas.user import UserOut
from app.security.jwt import create_access_token
from app.security.telegram_auth import TelegramUser

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DEV_USER = TelegramUser(
    id=900000001,
    first_name="Dev",
    last_name=None,
    username="dev_user",
    language_code="ru",
    photo_url=None,
)


@router.post("/dev-login", response_model=AuthResponse)
async def dev_login(
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthResponse:
    user = await users_repo.upsert_from_telegram(conn, _DEV_USER)
    token = create_access_token(user["id"], settings)
    return AuthResponse(access_token=token, user=UserOut(**user))
