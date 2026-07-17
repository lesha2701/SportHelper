from __future__ import annotations

from typing import Annotated, AsyncIterator

import asyncpg
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.repositories import users as users_repo
from app.security.jwt import InvalidToken, decode_access_token

# auto_error=False so a missing token surfaces as our own UnauthorizedError
# (consistent {"error": {...}} shape) instead of FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False, description="JWT returned by POST /api/auth/telegram")


def get_settings_dep() -> Settings:
    return get_settings()


async def get_db_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


async def get_db(
    pool: Annotated[asyncpg.Pool, Depends(get_db_pool)]
) -> AsyncIterator[asyncpg.Connection]:
    async with pool.acquire() as conn:
        yield conn


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    if credentials is None:
        raise UnauthorizedError("missing bearer token")

    token = credentials.credentials
    try:
        user_id = decode_access_token(token, settings)
    except InvalidToken as exc:
        raise UnauthorizedError("invalid or expired token") from exc

    user = await users_repo.get_by_id(conn, user_id)
    if user is None:
        raise UnauthorizedError("user not found")
    if user["is_banned"]:
        raise ForbiddenError("user is banned")

    return user
