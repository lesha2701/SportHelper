"""Data access for teams, membership, invites, join requests and blocks.

All queries are parameterized. Permission checks live in api/routes/teams.py
(this module only enforces data integrity, via DB constraints/triggers).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

_TEAM_FIELDS = (
    "id, name, description, sport, age_category, level, status, "
    "created_by, logo_file_id, created_at, updated_at"
)
_MEMBER_FIELDS = (
    "m.user_id, u.telegram_id, u.first_name, u.last_name, u.username, "
    "u.photo_url, m.role, m.position, m.joined_at"
)
_REQUEST_FIELDS = (
    "r.id, r.team_id, r.user_id, u.first_name, u.last_name, u.username, "
    "u.photo_url, r.status, r.created_at"
)


async def create_team(conn: asyncpg.Connection, creator_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
    async with conn.transaction():
        team = await conn.fetchrow(
            f"""
            INSERT INTO teams (name, description, sport, age_category, level, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING {_TEAM_FIELDS}
            """,
            data["name"],
            data.get("description"),
            data["sport"],
            data.get("age_category"),
            data.get("level"),
            creator_id,
        )
        await conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'head_coach')",
            team["id"],
            creator_id,
        )
    return dict(team)


async def get_team(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(f"SELECT {_TEAM_FIELDS} FROM teams WHERE id = $1", team_id)
    return dict(row) if row else None


async def update_team(conn: asyncpg.Connection, team_id: UUID, data: dict[str, Any]) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        UPDATE teams SET name = $2, description = $3, sport = $4, age_category = $5, level = $6
        WHERE id = $1
        RETURNING {_TEAM_FIELDS}
        """,
        team_id,
        data["name"],
        data.get("description"),
        data["sport"],
        data.get("age_category"),
        data.get("level"),
    )
    return dict(row)


async def list_my_teams(conn: asyncpg.Connection, user_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT
            t.id, t.name, t.description, t.sport, t.age_category, t.level, t.status,
            t.created_by, t.logo_file_id, t.created_at, t.updated_at,
            m.role AS my_role,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS members_count
        FROM teams t
        JOIN team_members m ON m.team_id = t.id
        WHERE m.user_id = $1
        ORDER BY t.created_at DESC
        """,
        user_id,
    )
    return [dict(row) for row in rows]


async def get_member(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT team_id, user_id, role, position, joined_at FROM team_members "
        "WHERE team_id = $1 AND user_id = $2",
        team_id,
        user_id,
    )
    return dict(row) if row else None


async def count_members(conn: asyncpg.Connection, team_id: UUID) -> int:
    return await conn.fetchval("SELECT COUNT(*) FROM team_members WHERE team_id = $1", team_id)


async def shares_team_as_coach(conn: asyncpg.Connection, coach_id: UUID, player_id: UUID) -> bool:
    """True if coach_id coaches (head or assistant) at least one team that
    player_id also belongs to — used to gate coach access to a player's
    personal stats/metrics."""
    value = await conn.fetchval(
        """
        SELECT 1
        FROM team_members coach_m
        JOIN team_members player_m ON player_m.team_id = coach_m.team_id
        WHERE coach_m.user_id = $1 AND coach_m.role IN ('head_coach', 'assistant_coach')
          AND player_m.user_id = $2
        LIMIT 1
        """,
        coach_id,
        player_id,
    )
    return value is not None


async def get_captain(conn: asyncpg.Connection, team_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT team_id, user_id, role, position, joined_at FROM team_members "
        "WHERE team_id = $1 AND role = 'captain'",
        team_id,
    )
    return dict(row) if row else None


async def list_members(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_MEMBER_FIELDS}
        FROM team_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1
        ORDER BY
            CASE m.role
                WHEN 'head_coach' THEN 0
                WHEN 'assistant_coach' THEN 1
                WHEN 'captain' THEN 2
                ELSE 3
            END,
            m.joined_at
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def get_member_detail(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        SELECT {_MEMBER_FIELDS}
        FROM team_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1 AND m.user_id = $2
        """,
        team_id,
        user_id,
    )
    return dict(row) if row else None


async def get_player_position(conn: asyncpg.Connection, user_id: UUID) -> str | None:
    return await conn.fetchval("SELECT position FROM player_profiles WHERE user_id = $1", user_id)


async def update_member(
    conn: asyncpg.Connection,
    team_id: UUID,
    user_id: UUID,
    *,
    role: str | None,
    position: str | None,
    position_set: bool,
) -> dict[str, Any] | None:
    if role is not None and position_set:
        row = await conn.fetchrow(
            "UPDATE team_members SET role = $3, position = $4 WHERE team_id = $1 AND user_id = $2 "
            "RETURNING team_id, user_id, role, position, joined_at",
            team_id,
            user_id,
            role,
            position,
        )
    elif role is not None:
        row = await conn.fetchrow(
            "UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2 "
            "RETURNING team_id, user_id, role, position, joined_at",
            team_id,
            user_id,
            role,
        )
    elif position_set:
        row = await conn.fetchrow(
            "UPDATE team_members SET position = $3 WHERE team_id = $1 AND user_id = $2 "
            "RETURNING team_id, user_id, role, position, joined_at",
            team_id,
            user_id,
            position,
        )
    else:
        return await get_member(conn, team_id, user_id)
    return dict(row) if row else None


async def remove_member(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> None:
    await conn.execute("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", team_id, user_id)


async def leave_team(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> str | None:
    """Remove a member; if they were the head coach, mark the team without a
    coach. Returns the role that left, or None if they weren't a member."""
    async with conn.transaction():
        member = await conn.fetchrow(
            "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING role",
            team_id,
            user_id,
        )
        if member is None:
            return None
        if member["role"] == "head_coach":
            await conn.execute("UPDATE teams SET status = 'without_coach' WHERE id = $1", team_id)
        return member["role"]


async def transfer_ownership(
    conn: asyncpg.Connection, team_id: UUID, from_user_id: UUID, to_user_id: UUID
) -> None:
    """Head coach hands the role to another current member; the outgoing
    head coach becomes an assistant coach rather than losing team access."""
    async with conn.transaction():
        await conn.execute(
            "UPDATE team_members SET role = 'assistant_coach' WHERE team_id = $1 AND user_id = $2",
            team_id,
            from_user_id,
        )
        await conn.execute(
            "UPDATE team_members SET role = 'head_coach' WHERE team_id = $1 AND user_id = $2",
            team_id,
            to_user_id,
        )
        await conn.execute("UPDATE teams SET status = 'active' WHERE id = $1", team_id)


async def promote_to_head_coach(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> None:
    """Used when accepting a captain-issued 'head_coach' invite on an
    orphaned team: makes the acceptor head coach and reactivates the team."""
    async with conn.transaction():
        existing = await get_member(conn, team_id, user_id)
        if existing:
            await conn.execute(
                "UPDATE team_members SET role = 'head_coach' WHERE team_id = $1 AND user_id = $2",
                team_id,
                user_id,
            )
        else:
            await conn.execute(
                "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'head_coach')",
                team_id,
                user_id,
            )
        await conn.execute("UPDATE teams SET status = 'active' WHERE id = $1", team_id)


async def block_member(
    conn: asyncpg.Connection, team_id: UUID, user_id: UUID, blocked_by: UUID
) -> None:
    async with conn.transaction():
        await conn.execute("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", team_id, user_id)
        await conn.execute(
            "INSERT INTO team_blocks (team_id, user_id, blocked_by) VALUES ($1, $2, $3) "
            "ON CONFLICT (team_id, user_id) DO NOTHING",
            team_id,
            user_id,
            blocked_by,
        )


async def is_blocked(conn: asyncpg.Connection, team_id: UUID, user_id: UUID) -> bool:
    row = await conn.fetchval(
        "SELECT 1 FROM team_blocks WHERE team_id = $1 AND user_id = $2", team_id, user_id
    )
    return row is not None


async def create_invite(
    conn: asyncpg.Connection, team_id: UUID, created_by: UUID, kind: str, ttl_hours: int
) -> dict[str, Any]:
    token = secrets.token_urlsafe(16)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    row = await conn.fetchrow(
        """
        INSERT INTO team_invites (team_id, token, kind, created_by, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, team_id, token, kind, expires_at, created_at
        """,
        team_id,
        token,
        kind,
        created_by,
        expires_at,
    )
    return dict(row)


async def list_invites(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT id, team_id, token, kind, expires_at, created_at FROM team_invites "
        "WHERE team_id = $1 AND expires_at > now() ORDER BY created_at DESC",
        team_id,
    )
    return [dict(row) for row in rows]


async def get_invite_by_token(conn: asyncpg.Connection, token: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT id, team_id, token, kind, created_by, expires_at, created_at FROM team_invites "
        "WHERE token = $1",
        token,
    )
    return dict(row) if row else None


async def get_pending_request(
    conn: asyncpg.Connection, team_id: UUID, user_id: UUID
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT id, team_id, user_id, invite_id, status, created_at FROM team_join_requests "
        "WHERE team_id = $1 AND user_id = $2 AND status = 'pending'",
        team_id,
        user_id,
    )
    return dict(row) if row else None


async def create_join_request(
    conn: asyncpg.Connection, team_id: UUID, user_id: UUID, invite_id: UUID
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        INSERT INTO team_join_requests (team_id, user_id, invite_id)
        VALUES ($1, $2, $3)
        RETURNING id, team_id, user_id, invite_id, status, created_at
        """,
        team_id,
        user_id,
        invite_id,
    )
    return dict(row)


async def list_pending_requests(conn: asyncpg.Connection, team_id: UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT {_REQUEST_FIELDS}
        FROM team_join_requests r
        JOIN users u ON u.id = r.user_id
        WHERE r.team_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at
        """,
        team_id,
    )
    return [dict(row) for row in rows]


async def get_request(conn: asyncpg.Connection, team_id: UUID, request_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT id, team_id, user_id, invite_id, status, created_at FROM team_join_requests "
        "WHERE team_id = $1 AND id = $2",
        team_id,
        request_id,
    )
    return dict(row) if row else None


async def accept_request(
    conn: asyncpg.Connection, request_id: UUID, team_id: UUID, user_id: UUID, reviewed_by: UUID
) -> None:
    async with conn.transaction():
        await conn.execute(
            "UPDATE team_join_requests SET status = 'accepted', reviewed_by = $2, reviewed_at = now() "
            "WHERE id = $1",
            request_id,
            reviewed_by,
        )
        position = await get_player_position(conn, user_id)
        await conn.execute(
            "INSERT INTO team_members (team_id, user_id, role, position) VALUES ($1, $2, 'player', $3)",
            team_id,
            user_id,
            position,
        )


async def reject_request(conn: asyncpg.Connection, request_id: UUID, reviewed_by: UUID) -> None:
    await conn.execute(
        "UPDATE team_join_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now() "
        "WHERE id = $1",
        request_id,
        reviewed_by,
    )
