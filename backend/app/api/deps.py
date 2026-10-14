from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, AsyncIterator

import asyncpg
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.repositories import mfa as mfa_repo
from app.repositories import sessions as sessions_repo
from app.repositories import users as users_repo
from app.security.sessions import CSRF_HEADER, session_expiry
from app.security.tokens import constant_time_equals, csrf_token_for, hash_token

# auto_error=False so a missing token surfaces as our own UnauthorizedError
# (consistent {"error": {...}} shape) instead of FastAPI's default 403.
bearer_scheme = HTTPBearer(
    auto_error=False,
    description=(
        "Session token. Browsers authenticate with the HttpOnly session cookie set by "
        "POST /api/auth/login; non-browser clients can send the same token as a Bearer token."
    ),
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_settings_dep() -> Settings:
    return get_settings()


async def get_db_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


async def get_db(
    pool: Annotated[asyncpg.Pool, Depends(get_db_pool)]
) -> AsyncIterator[asyncpg.Connection]:
    async with pool.acquire() as conn:
        yield conn


@dataclass
class AuthContext:
    """Everything known about the caller once their session is verified."""

    user: dict[str, Any]
    session: dict[str, Any]
    token: str
    via_cookie: bool


def extract_session_token(
    request: Request, credentials: HTTPAuthorizationCredentials | None, settings: Settings
) -> tuple[str | None, bool]:
    """(token, came_from_cookie). An explicit Authorization header wins over the cookie."""
    if credentials is not None and credentials.credentials:
        return credentials.credentials, False
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie:
        return cookie, True
    return None, False


async def _resolve_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
    conn: asyncpg.Connection,
    settings: Settings,
) -> AuthContext | None:
    token, via_cookie = extract_session_token(request, credentials, settings)
    if token is None:
        return None

    session = await sessions_repo.get_active(conn, hash_token(token))
    if session is None:
        return None
    user = await users_repo.get_by_id(conn, session["user_id"])
    if user is None or user.get("deleted_at") is not None:
        return None

    if via_cookie and request.method not in SAFE_METHODS:
        # Cookies are attached by the browser automatically, so a state-changing
        # request must also prove it came from our own page by echoing the
        # session-bound CSRF token (see /api/auth/me).
        supplied = request.headers.get(CSRF_HEADER, "")
        expected = csrf_token_for(token, settings.jwt_secret)
        if not supplied or not constant_time_equals(supplied, expected):
            raise ForbiddenError("CSRF token missing or invalid", code="csrf_failed")

    now = datetime.now(timezone.utc)
    last_seen = session["last_seen_at"]
    if last_seen is None or now - last_seen > timedelta(minutes=sessions_repo.TOUCH_INTERVAL_MINUTES):
        await sessions_repo.touch(conn, session["id"], user["id"], session_expiry(settings, session["created_at"]))

    return AuthContext(user=user, session=session, token=token, via_cookie=via_cookie)


async def get_auth_context(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthContext:
    ctx = await _resolve_context(request, credentials, conn, settings)
    if ctx is None:
        raise UnauthorizedError("authentication required")
    if ctx.user["is_banned"]:
        raise ForbiddenError("user is banned")
    return ctx


async def get_optional_context(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthContext | None:
    return await _resolve_context(request, credentials, conn, settings)


async def get_current_user(ctx: AuthContext = Depends(get_auth_context)) -> dict:
    return ctx.user


async def get_optional_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict | None:
    """For public GET endpoints: the signed-in user if there is a valid
    session, otherwise None (guests are fine, a stale cookie is ignored)."""
    ctx = await _resolve_context(request, credentials, conn, settings)
    if ctx is None or ctx.user["is_banned"]:
        return None
    return ctx.user


def is_admin(user: dict, settings: Settings) -> bool:
    """Admin rights come only from server configuration (ADMIN_EMAILS) and
    only for a verified email - nothing a client sends can grant them."""
    email = user.get("email")
    return bool(email and user.get("email_verified_at") and email.lower() in settings.admin_emails_list)


async def require_admin(
    ctx: AuthContext = Depends(get_auth_context),
    settings: Settings = Depends(get_settings_dep),
) -> AuthContext:
    if not is_admin(ctx.user, settings):
        raise ForbiddenError("administrator access required")
    return ctx


async def require_admin_mfa(
    ctx: AuthContext = Depends(require_admin),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> AuthContext:
    """Gate for financial / sensitive admin operations: an administrator must
    have a second factor enabled AND have passed it in this session recently."""
    mfa = await mfa_repo.get(conn, ctx.user["id"])
    if mfa is None or mfa["enabled_at"] is None:
        raise ForbiddenError("enable two-factor authentication to use this feature", code="mfa_setup_required")
    verified_at = ctx.session.get("mfa_verified_at")
    if verified_at is None or datetime.now(timezone.utc) - verified_at > timedelta(hours=settings.admin_mfa_session_hours):
        raise ForbiddenError("confirm your two-factor code to continue", code="mfa_required")
    return ctx
