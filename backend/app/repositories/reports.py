"""Data access for training reports (submitted by the responsible player for
an independent training, reviewed by the coach staff). All queries are
parameterized."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

_REPORT_FIELDS = (
    "training_id, submitted_by, text_report, photo_file_id, video_file_id, "
    "status, coach_comment, reviewed_by, reviewed_at, created_at, updated_at"
)


async def get_report(conn: asyncpg.Connection, training_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"SELECT {_REPORT_FIELDS} FROM training_reports WHERE training_id = $1", training_id
    )
    return dict(row) if row else None


async def upsert_report(
    conn: asyncpg.Connection, training_id: UUID, submitted_by: UUID, text_report: str
) -> dict[str, Any]:
    """Creates the report, or resubmits it: text can change and any previous
    coach review is cleared, moving the report back to 'pending'."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO training_reports (training_id, submitted_by, text_report, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (training_id) DO UPDATE SET
            text_report = EXCLUDED.text_report,
            status = 'pending',
            coach_comment = NULL,
            reviewed_by = NULL,
            reviewed_at = NULL
        RETURNING {_REPORT_FIELDS}
        """,
        training_id,
        submitted_by,
        text_report,
    )
    return dict(row)


async def set_photo(conn: asyncpg.Connection, training_id: UUID, file_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"UPDATE training_reports SET photo_file_id = $2 WHERE training_id = $1 RETURNING {_REPORT_FIELDS}",
        training_id,
        file_id,
    )
    return dict(row) if row else None


async def set_video(conn: asyncpg.Connection, training_id: UUID, file_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"UPDATE training_reports SET video_file_id = $2 WHERE training_id = $1 RETURNING {_REPORT_FIELDS}",
        training_id,
        file_id,
    )
    return dict(row) if row else None


async def review_report(
    conn: asyncpg.Connection, training_id: UUID, reviewed_by: UUID, status: str, coach_comment: str | None
) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        f"""
        UPDATE training_reports
        SET status = $2, coach_comment = $3, reviewed_by = $4, reviewed_at = now()
        WHERE training_id = $1
        RETURNING {_REPORT_FIELDS}
        """,
        training_id,
        status,
        coach_comment,
        reviewed_by,
    )
    return dict(row) if row else None


async def player_coach_comments(conn: asyncpg.Connection, user_id: UUID, limit: int = 20) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT 'Отчёт о тренировке' AS context, r.coach_comment AS comment, r.reviewed_at AS commented_at
        FROM training_reports r
        WHERE r.submitted_by = $1 AND r.coach_comment IS NOT NULL
        ORDER BY r.reviewed_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(row) for row in rows]


async def list_recent_team_reports(conn: asyncpg.Connection, team_id: UUID, limit: int = 10) -> list[dict[str, Any]]:
    """Recent independent-training reports for a team, newest first — used
    to feed the AI report-analysis feature."""
    rows = await conn.fetch(
        """
        SELECT t.training_date, r.text_report
        FROM training_reports r
        JOIN trainings t ON t.id = r.training_id
        WHERE t.team_id = $1
        ORDER BY t.training_date DESC, r.created_at DESC
        LIMIT $2
        """,
        team_id,
        limit,
    )
    return [dict(row) for row in rows]
