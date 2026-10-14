"""Shared (PostgreSQL) sliding-window rate limiting for the sensitive auth
endpoints. Shared, so it holds with several backend processes/containers; an
advisory lock per key makes check-then-record atomic, so concurrent requests
can't both slip under the limit."""
from __future__ import annotations

import asyncpg


async def hit(conn: asyncpg.Connection, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Records an attempt unless `key` already used up `limit` attempts in the
    last `window_seconds`. Returns (allowed, retry_after_seconds). Denied
    attempts are not recorded, so hammering a locked key doesn't extend the lock."""
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
        row = await conn.fetchrow(
            """
            SELECT count(*) AS used,
                   GREATEST(1, CEIL(EXTRACT(EPOCH FROM (min(hit_at) + make_interval(secs => $2) - now())))::int) AS retry
            FROM rate_limit_hits
            WHERE key = $1 AND hit_at > now() - make_interval(secs => $2)
            """,
            key,
            float(window_seconds),
        )
        if row["used"] >= limit:
            return False, int(row["retry"])
        await conn.execute("INSERT INTO rate_limit_hits (key) VALUES ($1)", key)
        return True, 0


async def purge_old(conn: asyncpg.Connection, *, older_than_seconds: int = 86400) -> int:
    result = await conn.execute(
        "DELETE FROM rate_limit_hits WHERE hit_at < now() - make_interval(secs => $1)", float(older_than_seconds)
    )
    return int(result.rsplit(" ", 1)[-1])
