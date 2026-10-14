"""A real PostgreSQL for the tests that must exercise actual SQL (migrations,
constraints, atomic token spending).

Uses TEST_DATABASE_URL when set (CI runs a postgres service), otherwise starts
an embedded server through the optional `pgserver` package, otherwise the
dependent tests are skipped. Nothing here touches a developer's real database.
"""
from __future__ import annotations

import os
import re
import tempfile
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest

_server = None


def admin_dsn() -> str | None:
    global _server
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    try:
        import pgserver
    except ImportError:
        return None
    if _server is None:
        _server = pgserver.get_server(tempfile.mkdtemp(prefix="sag_pg_"))
    return _server.get_uri()


def dsn_for(database: str, base: str) -> str:
    parts = urlsplit(base)
    return urlunsplit(parts._replace(path=f"/{database}"))


async def create_database(base: str) -> tuple[str, str]:
    """Creates an empty database and returns (name, dsn)."""
    import asyncpg

    name = "t_" + re.sub(r"-", "", str(uuid.uuid4()))[:20]
    admin = await asyncpg.connect(base)
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    return name, dsn_for(name, base)


async def drop_database(base: str, name: str) -> None:
    import asyncpg

    admin = await asyncpg.connect(base)
    try:
        await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
    finally:
        await admin.close()


def require_postgres() -> str:
    dsn = admin_dsn()
    if dsn is None:
        pytest.skip("no PostgreSQL available (set TEST_DATABASE_URL or `pip install pgserver`)")
    return dsn
