"""Data access for user_identities: external sign-in accounts (Yandex ID, VK ID, ...)
linked to a website account. See app/services/identities.py for the rules."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = "id, user_id, provider, provider_user_id, provider_email, provider_email_verified, display_name, created_at, last_login_at"


async def get_by_external(conn: asyncpg.Connection, provider: str, provider_user_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_FIELDS} FROM user_identities WHERE provider = $1 AND provider_user_id = $2", provider, provider_user_id
    )
    return dict(row) if row else None


async def list_for_user(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(f"SELECT {_FIELDS} FROM user_identities WHERE user_id = $1 ORDER BY created_at", user_id)
    return [dict(row) for row in rows]


async def link(
    conn: asyncpg.Connection,
    *,
    user_id: UUID,
    provider: str,
    provider_user_id: str,
    provider_email: str | None,
    provider_email_verified: bool,
    display_name: str | None,
) -> tuple[str, dict[str, Any] | None]:
    """("ok", row) | ("external_taken", None) - that external account belongs to someone
    else | ("provider_taken", None) - this user already has an account at that provider."""
    try:
        row = await conn.fetchrow(
            f"""
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email,
                                         provider_email_verified, display_name)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING {_FIELDS}
            """,
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_email_verified,
            display_name,
        )
    except asyncpg.UniqueViolationError as exc:
        if exc.constraint_name == "user_identities_one_per_provider":
            return "provider_taken", None
        return "external_taken", None
    return "ok", dict(row)


async def unlink(conn: asyncpg.Connection, user_id: UUID, provider: str) -> bool:
    result = await conn.execute("DELETE FROM user_identities WHERE user_id = $1 AND provider = $2", user_id, provider)
    return result.endswith(" 1")


async def touch_login(conn: asyncpg.Connection, identity_id: UUID) -> None:
    await conn.execute("UPDATE user_identities SET last_login_at = now() WHERE id = $1", identity_id)
