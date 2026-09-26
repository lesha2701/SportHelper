"""Global search across everything the current user can see. All queries are
parameterized; each entity type is capped so one type can't crowd out the rest."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

PER_TYPE_LIMIT = 5


def _like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def search_all(conn: asyncpg.Connection, user_id: UUID, query: str) -> list[dict[str, Any]]:
    pattern = _like_pattern(query)
    rows = await conn.fetch(
        """
        (SELECT 'team' AS type, t.id, t.name AS title, t.sport AS subtitle, t.id AS team_id, NULL::date AS on_date
           FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = $1
          WHERE t.name ILIKE $2 ORDER BY t.name LIMIT $3)
        UNION ALL
        (SELECT 'player', u.id, u.first_name || COALESCE(' ' || u.last_name, ''), tm.name, tm.id, NULL
           FROM team_members mine
           JOIN team_members other ON other.team_id = mine.team_id AND other.user_id <> $1
           JOIN users u ON u.id = other.user_id
           JOIN teams tm ON tm.id = mine.team_id
          WHERE mine.user_id = $1
            AND (u.first_name || ' ' || COALESCE(u.last_name, '') ILIKE $2 OR u.username ILIKE $2)
          ORDER BY u.first_name LIMIT $3)
        UNION ALL
        (SELECT 'coach', cl.coach_user_id, cp.full_name, cp.sport, NULL, NULL
           FROM coach_listings cl JOIN coach_profiles cp ON cp.user_id = cl.coach_user_id
          WHERE cl.is_listed = TRUE AND cl.deleted_at IS NULL AND cl.coach_user_id <> $1
            AND (cp.full_name ILIKE $2 OR cl.title ILIKE $2 OR cp.sport ILIKE $2 OR cl.location ILIKE $2)
          GROUP BY cl.coach_user_id, cp.full_name, cp.sport ORDER BY cp.full_name LIMIT $3)
        UNION ALL
        (SELECT 'exercise', e.id, e.name, e.sport, NULL, NULL
           FROM exercises e
          WHERE e.deleted_at IS NULL AND e.owner_id = $1 AND (e.name ILIKE $2 OR e.sport ILIKE $2)
          ORDER BY e.name LIMIT $3)
        UNION ALL
        (SELECT 'training', tr.id, COALESCE(NULLIF(tr.description, ''), NULLIF(tr.location, ''), 'Тренировка'),
                tr.location, tr.team_id, tr.training_date
           FROM trainings tr
          WHERE tr.deleted_at IS NULL
            AND (tr.created_by = $1 OR tr.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
            AND (tr.description ILIKE $2 OR tr.location ILIKE $2)
          ORDER BY tr.training_date DESC LIMIT $3)
        UNION ALL
        (SELECT 'match', mt.id, 'Матч с «' || mt.opponent_name || '»', mt.location, mt.team_id, mt.match_date
           FROM matches mt
          WHERE mt.deleted_at IS NULL
            AND mt.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
            AND (mt.opponent_name ILIKE $2 OR mt.tournament ILIKE $2 OR mt.location ILIKE $2)
          ORDER BY mt.match_date DESC LIMIT $3)
        UNION ALL
        (SELECT 'task', tk.id, tk.title, NULL, tk.team_id, tk.deadline::date
           FROM tasks tk
          WHERE tk.deleted_at IS NULL
            AND tk.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
            AND (tk.title ILIKE $2 OR tk.description ILIKE $2)
          ORDER BY tk.created_at DESC LIMIT $3)
        """,
        user_id,
        pattern,
        PER_TYPE_LIMIT,
    )
    return [dict(row) for row in rows]
