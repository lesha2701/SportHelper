"""Data access for training_ai_analyses: a coach's AI pre-session analysis of
the athlete, one per personal training. All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def upsert(
    conn: asyncpg.Connection,
    *,
    training_id: UUID,
    coach_user_id: UUID,
    player_user_id: UUID,
    analysis_json: str,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        INSERT INTO training_ai_analyses (training_id, coach_user_id, player_user_id, analysis_json)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (training_id) DO UPDATE SET
            coach_user_id = EXCLUDED.coach_user_id,
            player_user_id = EXCLUDED.player_user_id,
            analysis_json = EXCLUDED.analysis_json,
            generated_at = now()
        RETURNING training_id, analysis_json, generated_at
        """,
        training_id,
        coach_user_id,
        player_user_id,
        analysis_json,
    )
    return dict(row)


async def get_for_training(conn: asyncpg.Connection, training_id: UUID, coach_user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        "SELECT training_id, analysis_json, generated_at FROM training_ai_analyses "
        "WHERE training_id = $1 AND coach_user_id = $2",
        training_id,
        coach_user_id,
    )
    return dict(row) if row else None


async def delete_for_player(conn: asyncpg.Connection, player_user_id: UUID) -> None:
    """Called when a player withdraws consent: every stored analysis about
    them disappears."""
    await conn.execute("DELETE FROM training_ai_analyses WHERE player_user_id = $1", player_user_id)
