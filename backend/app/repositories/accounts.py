"""Multi-statement account operations that must be all-or-nothing: spending a
one-time token and applying its effect happen in one transaction, so a token
is never burnt without the change happening (or the reverse).

Each function returns a short status string plus the affected user, and the
HTTP layer maps that to a response."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import auth_tokens as tokens_repo
from app.repositories import users as users_repo


async def verify_email(conn: asyncpg.Connection, token_hash: str) -> tuple[str, dict[str, Any] | None]:
    """Confirms the address an `email_verify` token was issued for."""
    try:
        async with conn.transaction():
            token = await tokens_repo.consume(conn, token_hash, "email_verify")
            if token is None:
                return "invalid", None
            await conn.execute(
                "UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1 AND deleted_at IS NULL",
                token["user_id"],
                token["new_email"],
            )
            user = await users_repo.get_by_id(conn, token["user_id"])
    except asyncpg.UniqueViolationError:
        return "email_taken", None
    return "ok", user


async def reset_password(conn: asyncpg.Connection, token_hash: str, password_hash: str) -> dict[str, Any] | None:
    """Spends a `password_reset` token, sets the new password and ends every
    session of that user (the new password must not coexist with a stolen one)."""
    async with conn.transaction():
        token = await tokens_repo.consume(conn, token_hash, "password_reset")
        if token is None:
            return None
        await users_repo.set_password(conn, token["user_id"], password_hash)
        await conn.execute(
            "UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", token["user_id"]
        )
        # Other pending reset links are void now too.
        await conn.execute(
            "UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL",
            token["user_id"],
        )
        return await users_repo.get_by_id(conn, token["user_id"])


async def confirm_email_change(
    conn: asyncpg.Connection, token_hash: str
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Returns (status, user, old_email)."""
    try:
        async with conn.transaction():
            token = await tokens_repo.consume(conn, token_hash, "email_change")
            if token is None:
                return "invalid", None, None
            old_email = await conn.fetchval("SELECT email FROM users WHERE id = $1", token["user_id"])
            await conn.execute(
                "UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1 AND deleted_at IS NULL",
                token["user_id"],
                token["new_email"],
            )
            user = await users_repo.get_by_id(conn, token["user_id"])
    except asyncpg.UniqueViolationError:
        return "email_taken", None, None
    return "ok", user, old_email


async def claim_account(
    conn: asyncpg.Connection,
    *,
    claim_token_hash: str,
    email: str,
    password_hash: str,
    terms_version: str,
    verify_token_hash: str,
    verify_expires_at: datetime,
) -> tuple[str, dict[str, Any] | None]:
    """A legacy Telegram account (identified by a bot-issued one-time token)
    gets its first email + password. The email is NOT set on the row yet - it
    becomes the account's email only when its owner opens the verification
    link - so nobody can claim an address they don't control. The user id and
    every record hanging off it are untouched."""
    async with conn.transaction():
        # Cheap pre-check; the unique index still has the final word.
        taken = await conn.fetchval("SELECT 1 FROM users WHERE lower(email) = $1", email.lower())
        if taken:
            return "email_taken", None
        token = await tokens_repo.consume(conn, claim_token_hash, "telegram_claim")
        if token is None:
            return "invalid", None
        user_id: UUID = token["user_id"]
        updated = await conn.fetchval(
            "UPDATE users SET password_hash = $2, password_changed_at = now(), "
            "terms_accepted_at = now(), terms_version = $3 "
            "WHERE id = $1 AND email_verified_at IS NULL AND deleted_at IS NULL RETURNING id",
            user_id,
            password_hash,
            terms_version,
        )
        if updated is None:
            return "invalid", None
        await tokens_repo.create(
            conn,
            user_id=user_id,
            purpose="email_verify",
            token_hash=verify_token_hash,
            expires_at=verify_expires_at,
            new_email=email.lower(),
        )
        return "ok", await users_repo.get_by_id(conn, user_id)


async def link_telegram(
    conn: asyncpg.Connection, token_hash: str, telegram_id: int, username: str | None
) -> tuple[str, dict[str, Any] | None]:
    """Binds a Telegram account to a website account (for notifications).
    Never merges two accounts: if that Telegram already belongs to someone
    else, the link is refused."""
    try:
        async with conn.transaction():
            existing = await users_repo.get_by_telegram_id(conn, telegram_id)
            token = await tokens_repo.peek(conn, token_hash, "telegram_link")
            if token is None:
                return "invalid", None
            if existing is not None and existing["id"] != token["user_id"]:
                return "telegram_taken", None
            await tokens_repo.consume(conn, token_hash, "telegram_link")
            await users_repo.link_telegram(conn, token["user_id"], telegram_id, username)
            return "ok", await users_repo.get_by_id(conn, token["user_id"])
    except asyncpg.UniqueViolationError:
        return "telegram_taken", None
