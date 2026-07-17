"""Data access for team matches and their roster. All queries are
parameterized."""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

import asyncpg

_MATCH_FIELDS = (
    "id, team_id, created_by, opponent_name, match_date, start_time, location, "
    "is_home, tournament, status, our_score, opponent_score, comment, created_at, updated_at"
)
_ROSTER_FIELDS = "r.id, r.match_id, r.user_id, u.telegram_id, u.first_name, u.last_name, u.photo_url"
# Upcoming matches first (soonest at the top), then past ones below (most
# recent past first) — mirrors the ordering used for training lists.
_UPCOMING_FIRST_ORDER = """
    ORDER BY
        CASE WHEN match_date >= CURRENT_DATE THEN 0 ELSE 1 END,
        CASE WHEN match_date >= CURRENT_DATE THEN match_date END ASC,
        CASE WHEN match_date >= CURRENT_DATE THEN start_time END ASC,
        CASE WHEN match_date < CURRENT_DATE THEN match_date END DESC,
        CASE WHEN match_date < CURRENT_DATE THEN start_time END DESC
"""


async def create_match(conn: asyncpg.Connection, team_id: UUID, created_by: UUID, **fields: Any) -> dict[str, Any]:
    columns = ["team_id", "created_by", *fields.keys()]
    placeholders = [f"${i + 1}" for i in range(len(columns))]
    values = [team_id, created_by, *fields.values()]
    row = await conn.fetchrow(
        f"INSERT INTO matches ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING {_MATCH_FIELDS}",
        *values,
    )
    return dict(row)


async def get_match(conn: asyncpg.Connection, match_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_MATCH_FIELDS} FROM matches WHERE id = $1 AND deleted_at IS NULL", match_id)
    return dict(row) if row else None


async def update_match(conn: asyncpg.Connection, match_id: UUID, **fields: Any) -> dict[str, Any] | None:
    set_clauses = [f"{key} = ${i + 2}" for i, key in enumerate(fields.keys())]
    row = await conn.fetchrow(
        f"""
        UPDATE matches SET {", ".join(set_clauses)}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING {_MATCH_FIELDS}
        """,
        match_id,
        *fields.values(),
    )
    return dict(row) if row else None


async def set_result(
    conn: asyncpg.Connection, match_id: UUID, our_score: int, opponent_score: int, comment: str | None
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE matches SET our_score = $2, opponent_score = $3, comment = $4, status = 'completed'
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING {_MATCH_FIELDS}
        """,
        match_id,
        our_score,
        opponent_score,
        comment,
    )
    return dict(row) if row else None


async def soft_delete(conn: asyncpg.Connection, match_id: UUID) -> bool:
    result = await conn.execute("UPDATE matches SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL", match_id)
    return result.endswith("1")


async def list_team_matches(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_MATCH_FIELDS} FROM matches
        WHERE team_id = $1 AND deleted_at IS NULL
        {_UPCOMING_FIRST_ORDER}
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def team_match_summary(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed') AS played,
            COUNT(*) FILTER (WHERE status = 'completed' AND our_score > opponent_score) AS wins,
            COUNT(*) FILTER (WHERE status = 'completed' AND our_score < opponent_score) AS losses,
            COUNT(*) FILTER (WHERE status = 'completed' AND our_score = opponent_score) AS draws
        FROM matches
        WHERE team_id = $1 AND deleted_at IS NULL
        """,
        team_id,
    )
    return dict(row)


async def player_match_history(conn: asyncpg.Connection, user_id: UUID, limit: int = 10) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT m.id, m.opponent_name, m.match_date, m.our_score, m.opponent_score, m.status, tm.name AS team_name
        FROM matches m
        JOIN teams tm ON tm.id = m.team_id
        WHERE m.deleted_at IS NULL AND m.status = 'completed'
          AND m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
        ORDER BY m.match_date DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(row) for row in rows]


async def list_calendar_matches(
    conn: asyncpg.Connection, user_id: UUID, date_from: date, date_to: date
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT m.id, m.opponent_name, m.match_date, m.start_time, m.status, m.team_id, tm.name AS team_name
        FROM matches m
        JOIN teams tm ON tm.id = m.team_id
        WHERE m.deleted_at IS NULL
          AND m.match_date BETWEEN $2 AND $3
          AND m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
        ORDER BY m.match_date, m.start_time
        """,
        user_id,
        date_from,
        date_to,
    )
    return [dict(row) for row in rows]


async def set_roster(conn: asyncpg.Connection, match_id: UUID, user_ids: list[UUID]) -> None:
    async with conn.transaction():
        await conn.execute("DELETE FROM match_roster WHERE match_id = $1", match_id)
        for user_id in user_ids:
            await conn.execute(
                "INSERT INTO match_roster (match_id, user_id) VALUES ($1, $2)", match_id, user_id
            )


async def list_roster(conn: asyncpg.Connection, match_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_ROSTER_FIELDS}
        FROM match_roster r
        JOIN users u ON u.id = r.user_id
        WHERE r.match_id = $1
        ORDER BY u.first_name
        """,
        match_id,
    )
    return [dict(row) for row in rows]
