"""Data access for the administration audit trail (website administrators' actions; older rows
were written by bot administrators). The table is append-only. All queries are parameterized."""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg


async def record_audit(
    conn: asyncpg.Connection,
    *,
    admin_telegram_id: int | None = None,
    admin_user_id: UUID | None = None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
    reason: str | None = None,
    result: str = "success",
) -> None:
    """`admin_user_id` is the website administrator; `admin_telegram_id` is only set on rows written by the former bot commands.
    The table is append-only (database trigger): entries are never edited or removed."""
    await conn.execute(
        """
        INSERT INTO admin_audit_log (admin_telegram_id, admin_user_id, action, target_type, target_id, details, reason, result)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        admin_telegram_id,
        admin_user_id,
        action,
        target_type,
        target_id,
        json.dumps(details) if details is not None else None,
        reason,
        result,
    )


async def list_audit(
    conn: asyncpg.Connection,
    *,
    limit: int,
    offset: int,
    action: str | None = None,
    target_type: str | None = None,
    result: str | None = None,
    query: str | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """The administrators' audit trail, newest first. `query` matches the acting administrator's email, the
    reason text, or - when it is a plain id - the object acted upon."""
    escaped = None
    if query and query.strip():
        escaped = "%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    where = """
        WHERE ($1::text IS NULL OR a.action = $1) AND ($2::text IS NULL OR a.target_type = $2) AND ($3::text IS NULL OR a.result = $3)
          AND ($4::text IS NULL OR u.email ILIKE $4 OR a.reason ILIKE $4 OR a.target_id = $5)
    """
    args = (action, target_type, result, escaped, query.strip() if query else None)
    total = await conn.fetchval(
        f"SELECT count(*) FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id {where}", *args
    )
    rows = await conn.fetch(
        f"""
        SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.reason, a.result, a.created_at,
               a.admin_telegram_id, a.admin_user_id, u.email AS admin_email
        FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_user_id
        {where}
        ORDER BY a.created_at DESC, a.id
        LIMIT $6 OFFSET $7
        """,
        *args,
        limit,
        offset,
    )
    return total, [dict(row) for row in rows]
