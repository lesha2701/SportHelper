"""Data access for the users table. All queries are parameterized.

`password_hash` is deliberately not part of the regular user row: it is
fetched only by the functions that need it (login, change-password), so it can
never leak through a response model by accident."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

_SELECT_FIELDS = (
    "id, telegram_id, username, first_name, last_name, photo_url, "
    "(SELECT hf.id FROM files hf WHERE hf.id = users.avatar_file_id AND hf.hidden_at IS NULL) AS avatar_file_id, "
    "language_code, (is_banned AND (banned_until IS NULL OR banned_until > now())) AS is_banned, banned_at, active_mode, last_login_at, created_at, updated_at, "
    "completed_onboarding_version, email, email_verified_at, preferred_role, "
    "terms_accepted_at, terms_version, password_changed_at, deletion_requested_at, deleted_at, "
    "(password_hash IS NOT NULL) AS has_password"
)


async def get_by_id(conn: asyncpg.Connection, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT_FIELDS} FROM users WHERE id = $1", user_id)
    return dict(row) if row else None


async def get_by_telegram_id(conn: asyncpg.Connection, telegram_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT_FIELDS} FROM users WHERE telegram_id = $1", telegram_id)
    return dict(row) if row else None


async def get_by_email(conn: asyncpg.Connection, email: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_SELECT_FIELDS} FROM users WHERE lower(email) = $1", email.lower())
    return dict(row) if row else None


async def get_credentials_by_email(conn: asyncpg.Connection, email: str) -> dict[str, Any] | None:
    """The user row plus everything login needs: the hash and lockout state."""
    row = await conn.fetchrow(
        f"SELECT {_SELECT_FIELDS}, password_hash, failed_login_count, locked_until "
        "FROM users WHERE lower(email) = $1",
        email.lower(),
    )
    return dict(row) if row else None


async def get_password_hash(conn: asyncpg.Connection, user_id: UUID) -> str | None:
    return await conn.fetchval("SELECT password_hash FROM users WHERE id = $1", user_id)


async def create_with_password(
    conn: asyncpg.Connection,
    *,
    email: str,
    password_hash: str,
    first_name: str,
    last_name: str | None,
    preferred_role: str | None,
    terms_version: str,
) -> dict[str, Any]:
    """Raises asyncpg.UniqueViolationError if the email is already taken."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO users (email, password_hash, first_name, last_name, preferred_role,
                           terms_accepted_at, terms_version, password_changed_at)
        VALUES ($1, $2, $3, $4, $5, now(), $6, now())
        RETURNING {_SELECT_FIELDS}
        """,
        email.lower(),
        password_hash,
        first_name,
        last_name,
        preferred_role,
        terms_version,
    )
    return dict(row)


async def restart_unverified_registration(
    conn: asyncpg.Connection,
    user_id: UUID,
    *,
    password_hash: str,
    first_name: str,
    last_name: str | None,
    preferred_role: str | None,
    terms_version: str,
) -> dict[str, Any] | None:
    """Re-registering an email whose owner never confirmed it replaces the
    credentials of that never-used account (so a stranger can't squat an
    address). Only touches rows that are still unverified and have no
    Telegram identity (i.e. were created by web registration)."""
    row = await conn.fetchrow(
        f"""
        UPDATE users SET password_hash = $2, first_name = $3, last_name = $4, preferred_role = $5,
            terms_accepted_at = now(), terms_version = $6, password_changed_at = now(),
            failed_login_count = 0, locked_until = NULL
        WHERE id = $1 AND email_verified_at IS NULL AND telegram_id IS NULL
        RETURNING {_SELECT_FIELDS}
        """,
        user_id,
        password_hash,
        first_name,
        last_name,
        preferred_role,
        terms_version,
    )
    return dict(row) if row else None


async def set_password(conn: asyncpg.Connection, user_id: UUID, password_hash: str) -> None:
    await conn.execute(
        "UPDATE users SET password_hash = $2, password_changed_at = now(), "
        "failed_login_count = 0, locked_until = NULL WHERE id = $1",
        user_id,
        password_hash,
    )


async def register_login_failure(
    conn: asyncpg.Connection, user_id: UUID, *, max_failures: int, lockout_minutes: int
) -> datetime | None:
    """Counts a wrong password. Returns locked_until if this attempt tripped
    the lock, else None. The counter resets after a lock so each lockout
    needs another `max_failures` wrong guesses."""
    row = await conn.fetchrow(
        """
        UPDATE users SET
            failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
            locked_until = CASE WHEN failed_login_count + 1 >= $2
                                THEN now() + make_interval(mins => $3) ELSE locked_until END
        WHERE id = $1
        RETURNING locked_until, (failed_login_count = 0) AS just_locked
        """,
        user_id,
        max_failures,
        lockout_minutes,
    )
    if row and row["just_locked"]:
        return row["locked_until"]
    return None


async def clear_login_failures(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
        user_id,
    )


async def set_preferred_role(conn: asyncpg.Connection, user_id: UUID, role: str) -> bool:
    """Fixes the role of an account that has none yet. Never changes a role that is already set."""
    updated = await conn.fetchval(
        "UPDATE users SET preferred_role = $2 WHERE id = $1 AND preferred_role IS NULL RETURNING id", user_id, role
    )
    return updated is not None


async def set_active_mode(conn: asyncpg.Connection, user_id: UUID, mode: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"UPDATE users SET active_mode = $2 WHERE id = $1 RETURNING {_SELECT_FIELDS}", user_id, mode
    )
    return dict(row) if row else None


async def link_telegram(conn: asyncpg.Connection, user_id: UUID, telegram_id: int, username: str | None) -> None:
    """Raises asyncpg.UniqueViolationError if that Telegram account already
    belongs to another user."""
    await conn.execute(
        "UPDATE users SET telegram_id = $2, username = COALESCE($3, username) WHERE id = $1",
        user_id,
        telegram_id,
        username,
    )


async def unlink_telegram(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute("UPDATE users SET telegram_id = NULL WHERE id = $1", user_id)


async def request_deletion(conn: asyncpg.Connection, user_id: UUID) -> datetime | None:
    return await conn.fetchval(
        "UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, now()) "
        "WHERE id = $1 AND deleted_at IS NULL RETURNING deletion_requested_at",
        user_id,
    )


async def cancel_deletion(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute(
        "UPDATE users SET deletion_requested_at = NULL WHERE id = $1 AND deleted_at IS NULL", user_id
    )


async def list_due_for_deletion(conn: asyncpg.Connection, *, older_than: datetime, limit: int = 50) -> list[UUID]:
    rows = await conn.fetch(
        "SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL "
        "AND deletion_requested_at < $1 ORDER BY deletion_requested_at LIMIT $2",
        older_than,
        limit,
    )
    return [row["id"] for row in rows]


async def anonymize(conn: asyncpg.Connection, user_id: UUID) -> None:
    """Erases personal data but keeps the row (and its id), so trainings,
    bookings, reviews and - above all - any financial history that references
    the user stay intact and are never cascade-deleted."""
    async with conn.transaction():
        await conn.execute(
            """
            UPDATE users SET
                email = NULL, email_verified_at = NULL, password_hash = NULL,
                telegram_id = NULL, username = NULL, photo_url = NULL, avatar_file_id = NULL,
                first_name = 'Удалённый пользователь', last_name = NULL, language_code = NULL,
                active_mode = NULL, deleted_at = now()
            WHERE id = $1
            """,
            user_id,
        )
        # Profiles are blanked rather than deleted: coach_listings, bookings and
        # reviews reference them, and removing them would cascade through
        # records that must survive.
        await conn.execute(
            "UPDATE player_profiles SET full_name = 'Удалённый пользователь', age = NULL, height_cm = NULL, "
            "weight_kg = NULL, position = NULL, goals = NULL, load_restrictions = NULL WHERE user_id = $1",
            user_id,
        )
        await conn.execute(
            "UPDATE coach_profiles SET full_name = 'Удалённый пользователь', specialization = NULL, "
            "description = NULL WHERE user_id = $1",
            user_id,
        )
        await conn.execute("UPDATE coach_listings SET is_listed = FALSE WHERE coach_user_id = $1", user_id)
        await conn.execute(
            "UPDATE profile_media SET deleted_at = now() WHERE user_id = $1 AND deleted_at IS NULL", user_id
        )
        await conn.execute("DELETE FROM user_sessions WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM auth_tokens WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM user_mfa WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM user_identities WHERE user_id = $1", user_id)


async def get_ai_analysis_consent(conn: asyncpg.Connection, user_id: UUID) -> bool:
    """Whether the user lets their personal coaches run AI analysis on their
    sports data. Defaults to False (explicit opt-in)."""
    value = await conn.fetchval(
        "SELECT allow_ai_analysis_by_personal_coach FROM users WHERE id = $1", user_id
    )
    return bool(value)


async def set_ai_analysis_consent(conn: asyncpg.Connection, user_id: UUID, allowed: bool) -> bool:
    value = await conn.fetchval(
        "UPDATE users SET allow_ai_analysis_by_personal_coach = $2 WHERE id = $1 "
        "RETURNING allow_ai_analysis_by_personal_coach",
        user_id,
        allowed,
    )
    return bool(value)


async def complete_onboarding(
    conn: asyncpg.Connection, user_id: UUID, version: int
) -> dict[str, Any] | None:
    """Marks the welcome guide up to `version` as done. Never lowers the
    stored value (e.g. a stale client can't make a user see v1 again)."""
    row = await conn.fetchrow(
        f"UPDATE users SET completed_onboarding_version = GREATEST(completed_onboarding_version, $2) "
        f"WHERE id = $1 RETURNING {_SELECT_FIELDS}",
        user_id,
        version,
    )
    return dict(row) if row else None
