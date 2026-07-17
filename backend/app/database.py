"""asyncpg connection pool + SQL schema/patch runner.

Migration strategy (per project spec, no Alembic):
  * database/schema.sql   — full schema for a brand new database, ends by
                             inserting the baseline row into schema_versions.
  * database/patches/*.sql — sequentially numbered patches (0002_*.sql, ...)
                              applied in order on top of the baseline.
  * schema_versions table  — tracks which version is currently applied.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import asyncpg

from app.config import DATABASE_DIR, Settings

logger = logging.getLogger("teamflow.database")

_PATCH_NAME_RE = re.compile(r"^(\d+)_.*\.sql$")


async def create_pool(settings: Settings) -> asyncpg.Pool:
    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=settings.database_pool_min_size,
        max_size=settings.database_pool_max_size,
    )
    return pool


async def _schema_versions_exists(conn: asyncpg.Connection) -> bool:
    row = await conn.fetchrow(
        "SELECT to_regclass('public.schema_versions') AS reg"
    )
    return row["reg"] is not None


async def _current_version(conn: asyncpg.Connection) -> int:
    row = await conn.fetchrow("SELECT COALESCE(MAX(version), 0) AS version FROM schema_versions")
    return int(row["version"])


def _discover_patches() -> list[tuple[int, Path]]:
    patches_dir = DATABASE_DIR / "patches"
    if not patches_dir.exists():
        return []
    patches: list[tuple[int, Path]] = []
    for path in patches_dir.glob("*.sql"):
        match = _PATCH_NAME_RE.match(path.name)
        if not match:
            logger.warning("Skipping patch with unexpected filename: %s", path.name)
            continue
        patches.append((int(match.group(1)), path))
    patches.sort(key=lambda item: item[0])
    return patches


async def run_migrations(pool: asyncpg.Pool) -> None:
    """Apply schema.sql (fresh DB) and/or any pending patches (existing DB)."""
    async with pool.acquire() as conn:
        if not await _schema_versions_exists(conn):
            schema_path = DATABASE_DIR / "schema.sql"
            logger.info("schema_versions not found, applying baseline schema.sql")
            sql = schema_path.read_text(encoding="utf-8")
            async with conn.transaction():
                await conn.execute(sql)

        current_version = await _current_version(conn)
        for version, path in _discover_patches():
            if version <= current_version:
                continue
            logger.info("Applying patch %s (version %s)", path.name, version)
            sql = path.read_text(encoding="utf-8")
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO schema_versions (version, name) VALUES ($1, $2)",
                    version,
                    path.name,
                )
            current_version = version


async def check_connection(pool: asyncpg.Pool) -> bool:
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:  # noqa: BLE001 - health check must never raise
        logger.exception("Database health check failed")
        return False
