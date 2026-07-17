"""Data access for the bot's admin commands: paginated users/teams lookups,
ban/unban, project-wide stats, the admin audit trail and the sanitized error
log. All queries are parameterized."""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg

_USER_FIELDS = (
    "id, telegram_id, username, first_name, last_name, is_banned, banned_at, "
    "last_login_at, created_at"
)


async def count_users(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT COUNT(*) FROM users")


async def list_users(conn: asyncpg.Connection, *, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_USER_FIELDS},
            (SELECT COUNT(*) FROM team_members m WHERE m.user_id = u.id) AS teams_count
        FROM users u
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return [dict(row) for row in rows]


async def get_user_by_telegram_id(conn: asyncpg.Connection, telegram_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_USER_FIELDS} FROM users WHERE telegram_id = $1", telegram_id)
    return dict(row) if row else None


async def get_user_detail(conn: asyncpg.Connection, telegram_id: int) -> dict[str, Any] | None:
    user = await get_user_by_telegram_id(conn, telegram_id)
    if user is None:
        return None
    has_player_profile = await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM player_profiles WHERE user_id = $1)", user["id"]
    )
    has_coach_profile = await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM coach_profiles WHERE user_id = $1)", user["id"]
    )
    teams = await conn.fetch(
        """
        SELECT t.id, t.name, m.role
        FROM team_members m
        JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = $1
        ORDER BY m.joined_at DESC
        """,
        user["id"],
    )
    return {
        **user,
        "has_player_profile": has_player_profile,
        "has_coach_profile": has_coach_profile,
        "teams": [dict(row) for row in teams],
    }


async def set_banned(conn: asyncpg.Connection, telegram_id: int, banned: bool) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE users
        SET is_banned = $2, banned_at = CASE WHEN $2 THEN now() ELSE NULL END
        WHERE telegram_id = $1
        RETURNING {_USER_FIELDS}
        """,
        telegram_id,
        banned,
    )
    return dict(row) if row else None


async def list_active_recipient_telegram_ids(conn: asyncpg.Connection) -> list[int]:
    rows = await conn.fetch("SELECT telegram_id FROM users WHERE is_banned = FALSE ORDER BY created_at")
    return [row["telegram_id"] for row in rows]


_TEAM_FIELDS = (
    "id, name, sport, level, status, created_at"
)


async def count_teams(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT COUNT(*) FROM teams")


async def list_teams(conn: asyncpg.Connection, *, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_TEAM_FIELDS},
            (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS members_count
        FROM teams t
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return [dict(row) for row in rows]


async def get_team_detail(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any] | None:
    team = await conn.fetchrow(
        f"""
        SELECT {_TEAM_FIELDS}, description,
            (SELECT first_name || COALESCE(' ' || last_name, '') FROM users u
                JOIN team_members m ON m.user_id = u.id
                WHERE m.team_id = t.id AND m.role = 'head_coach') AS head_coach_name
        FROM teams t WHERE t.id = $1
        """,
        team_id,
    )
    if team is None:
        return None
    counts = await conn.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM team_members WHERE team_id = $1) AS members_count,
            (SELECT COUNT(*) FROM trainings WHERE team_id = $1 AND deleted_at IS NULL) AS trainings_count,
            (SELECT COUNT(*) FROM matches WHERE team_id = $1 AND deleted_at IS NULL) AS matches_count,
            (SELECT COUNT(*) FROM tasks WHERE team_id = $1 AND deleted_at IS NULL) AS tasks_count
        """,
        team_id,
    )
    return {**dict(team), **dict(counts)}


async def get_project_stats(conn: asyncpg.Connection) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM users WHERE is_banned) AS banned_users,
            (SELECT COUNT(*) FROM teams) AS total_teams,
            (SELECT COUNT(*) FROM teams WHERE status = 'without_coach') AS teams_without_coach,
            (SELECT COUNT(*) FROM trainings WHERE deleted_at IS NULL) AS total_trainings,
            (SELECT COUNT(*) FROM matches WHERE deleted_at IS NULL) AS total_matches,
            (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL) AS total_tasks,
            (SELECT COUNT(*) FROM files WHERE deleted_at IS NULL) AS total_files,
            (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE deleted_at IS NULL) AS total_files_size_bytes,
            (SELECT COUNT(*) FROM notifications WHERE status = 'pending') AS pending_notifications,
            (SELECT COUNT(*) FROM exercises) AS total_exercises,
            (SELECT COUNT(*) FROM training_plans) AS total_plans
        """
    )
    return dict(row)


async def record_audit(
    conn: asyncpg.Connection,
    *,
    admin_telegram_id: int,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    await conn.execute(
        """
        INSERT INTO admin_audit_log (admin_telegram_id, action, target_type, target_id, details)
        VALUES ($1, $2, $3, $4, $5)
        """,
        admin_telegram_id,
        action,
        target_type,
        target_id,
        json.dumps(details) if details is not None else None,
    )


async def list_recent_errors(conn: asyncpg.Connection, *, limit: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT source, logger_name, message, created_at FROM error_log ORDER BY created_at DESC LIMIT $1",
        limit,
    )
    return [dict(row) for row in rows]
