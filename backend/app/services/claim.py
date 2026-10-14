"""The bot-side half of moving a legacy Telegram account to email + password."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from app.config import Settings
from app.repositories import auth_tokens as tokens_repo
from app.repositories import users as users_repo
from app.security.tokens import generate_token, hash_token


def is_claimable(user: dict[str, Any] | None) -> bool:
    """A legacy account that has no confirmed email yet (and isn't banned/deleted)."""
    return bool(
        user is not None
        and user["email_verified_at"] is None
        and not user["is_banned"]
        and user.get("deleted_at") is None
    )


async def issue_claim_token(conn: asyncpg.Connection, user: dict[str, Any], settings: Settings) -> str:
    """Called by the bot after Telegram itself has told us who is writing, so
    possession of the Telegram account is the proof of ownership. A newer
    link replaces any earlier one; each works once and for a short time."""
    token = generate_token()
    await tokens_repo.create(
        conn,
        user_id=user["id"],
        purpose="telegram_claim",
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.telegram_token_ttl_minutes),
    )
    return token


def mask_email(email: str) -> str:
    """"alice@example.com" -> "a***e@example.com": enough to recognise your own address."""
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        return f"{local[:1]}***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


async def owner_of_link_token(conn: asyncpg.Connection, token: str) -> str | None:
    """A masked label of the website account a Telegram-link token belongs to
    (None if the token is unknown/expired), for the bot's confirmation message."""
    pending = await tokens_repo.peek(conn, hash_token(token), "telegram_link")
    if pending is None:
        return None
    user = await users_repo.get_by_id(conn, pending["user_id"])
    if user is None:
        return None
    return mask_email(user["email"]) if user.get("email") else user["first_name"]
