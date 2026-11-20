"""A trainer's personal commission percent: the history of its changes (database/patches/0053). The latest row of a trainer is what applies;
a row without a percent hands the trainer back to the general commission."""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg

from app.repositories.admin_users import like_pattern


async def latest(conn: asyncpg.Connection, coach_user_id: UUID) -> Decimal | None:
    """The personal percent in force, or None while the trainer pays the general commission."""
    value = await conn.fetchval("SELECT percent FROM coach_commission_changes WHERE coach_user_id = $1 ORDER BY id DESC LIMIT 1", coach_user_id)
    return None if value is None else Decimal(value)


async def record_change(
    conn: asyncpg.Connection, *, coach_user_id: UUID, percent: Decimal | None, previous: Decimal, reason: str, changed_by: UUID
) -> None:
    await conn.execute(
        "INSERT INTO coach_commission_changes (coach_user_id, percent, previous, reason, changed_by) VALUES ($1, $2, $3, $4, $5)",
        coach_user_id, percent, previous, reason, changed_by,
    )


_COACH_ROW = """
    SELECT u.id, u.email, u.first_name, u.last_name, cc.percent AS personal_percent, cc.created_at AS since, cc.reason, cc.changed_by_email
    FROM users u
    JOIN coach_profiles cp ON cp.user_id = u.id
    LEFT JOIN LATERAL (
        SELECT c.percent, c.reason, c.created_at, a.email AS changed_by_email
        FROM coach_commission_changes c LEFT JOIN users a ON a.id = c.changed_by
        WHERE c.coach_user_id = u.id ORDER BY c.id DESC LIMIT 1
    ) cc ON true
"""


def _row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
    if data["personal_percent"] is None:  # «back to the general one» is not a personal setting
        data["since"] = data["reason"] = data["changed_by_email"] = None
    return data


async def get_coach(conn: asyncpg.Connection, coach_user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"{_COACH_ROW} WHERE u.id = $1 AND u.deleted_at IS NULL", coach_user_id)
    return None if row is None else _row(row)


async def search_coaches(
    conn: asyncpg.Connection, *, query: str | None, only_personal: bool, limit: int, offset: int
) -> tuple[int, list[dict[str, Any]]]:
    """Trainers (users with a coach profile) by name or e-mail, those with a personal percent first."""
    pattern = like_pattern(query)
    where = """
        WHERE u.deleted_at IS NULL
          AND ($1::text IS NULL OR u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
               OR (u.first_name || ' ' || COALESCE(u.last_name, '')) ILIKE $1)
          AND (NOT $2::boolean OR cc.percent IS NOT NULL)
    """
    total = await conn.fetchval(f"SELECT count(*) FROM ({_COACH_ROW} {where}) t", pattern, only_personal)
    rows = await conn.fetch(
        f"{_COACH_ROW} {where} ORDER BY (cc.percent IS NOT NULL) DESC, u.first_name, u.last_name, u.id LIMIT $3 OFFSET $4",
        pattern, only_personal, limit, offset,
    )
    return total, [_row(r) for r in rows]
