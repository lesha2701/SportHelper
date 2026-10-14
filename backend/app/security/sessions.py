"""Session lifecycle: issuing the opaque id, setting/clearing the cookie."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import Request, Response

from app.config import Settings
from app.repositories import sessions as sessions_repo
from app.security.client import client_ip
from app.security.tokens import generate_token, hash_token

# Header carrying the CSRF token on state-changing requests made with the cookie.
CSRF_HEADER = "x-csrf-token"


def session_expiry(settings: Settings, created_at: datetime | None = None) -> datetime:
    """Idle lifetime from now, but never beyond the absolute cap measured
    from when the session was created."""
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(days=settings.session_lifetime_days)
    if created_at is not None:
        expiry = min(expiry, created_at + timedelta(days=settings.session_absolute_max_days))
    return expiry


async def start_session(
    conn: asyncpg.Connection, request: Request, user_id: Any, settings: Settings
) -> tuple[str, dict[str, Any]]:
    """Creates a session row and returns (raw token, row). The raw token is
    only ever sent to the browser; the database stores its hash."""
    token = generate_token()
    row = await sessions_repo.create(
        conn,
        user_id=user_id,
        token_hash=hash_token(token),
        expires_at=session_expiry(settings),
        user_agent=request.headers.get("user-agent"),
        ip_address=client_ip(request, settings),
    )
    return token, row


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_lifetime_days * 86400,
        path="/",
        domain=settings.cookie_domain or None,
        secure=settings.secure_cookies,
        httponly=True,
        samesite=settings.cookie_samesite.lower(),  # type: ignore[arg-type]
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        domain=settings.cookie_domain or None,
        secure=settings.secure_cookies,
        httponly=True,
        samesite=settings.cookie_samesite.lower(),  # type: ignore[arg-type]
    )
