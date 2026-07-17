"""Data access for lightweight self-reported training feedback (wellbeing,
difficulty, a short comment) — feeds the AI training-evaluation feature.
All queries are parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_FIELDS = "training_id, user_id, wellbeing, difficulty, comment, skipped, created_at"


async def get_feedback(conn: asyncpg.Connection, training_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_FIELDS} FROM training_feedback WHERE training_id = $1 AND user_id = $2",
        training_id,
        user_id,
    )
    return dict(row) if row else None


async def upsert_feedback(
    conn: asyncpg.Connection,
    training_id: UUID,
    user_id: UUID,
    *,
    wellbeing: int | None,
    difficulty: int | None,
    comment: str | None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO training_feedback (training_id, user_id, wellbeing, difficulty, comment, skipped)
        VALUES ($1, $2, $3, $4, $5, FALSE)
        ON CONFLICT (training_id, user_id) DO UPDATE SET
            wellbeing = EXCLUDED.wellbeing,
            difficulty = EXCLUDED.difficulty,
            comment = EXCLUDED.comment,
            skipped = FALSE
        RETURNING {_FIELDS}
        """,
        training_id,
        user_id,
        wellbeing,
        difficulty,
        comment,
    )
    return dict(row)


async def mark_skipped(conn: asyncpg.Connection, training_id: UUID, user_id: UUID) -> dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        INSERT INTO training_feedback (training_id, user_id, skipped)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (training_id, user_id) DO UPDATE SET skipped = TRUE
        RETURNING {_FIELDS}
        """,
        training_id,
        user_id,
    )
    return dict(row)
