"""Run the existing HTTP API tests against a REAL PostgreSQL instead of the
in-memory fakes:

    SAG_TEST_REAL_DB=1 python -m pytest tests/test_teams_api.py ...

Same requests, same assertions, but every query is real SQL - the regression net
for SQL the fakes never execute (column lists, joins, constraints). Each test gets
its own database, cloned from a migrated template (fast), and is dropped after.
Tests that reach into the fakes' internals (`client.bookings_store`, monkeypatched
repositories, ...) can't run in this mode and are reported by the runner script.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
from fastapi.testclient import TestClient

from tests import pg_support

ENABLED = os.environ.get("SAG_TEST_REAL_DB") == "1"

_template: dict[str, str] = {}


def _run(coro):
    return asyncio.run(coro)


async def _migrated_template(base: str) -> str:
    from app.config import Settings
    from app.database import create_pool, run_migrations

    name = "sag_template_" + uuid.uuid4().hex[:10]
    admin = await asyncpg.connect(base)
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
    finally:
        await admin.close()
    pool = await create_pool(Settings(_env_file=None, DATABASE_URL=pg_support.dsn_for(name, base)))
    try:
        await run_migrations(pool)
    finally:
        await pool.close()
    return name


async def _clone(base: str, template: str) -> str:
    name = "t_" + uuid.uuid4().hex[:18]
    admin = await asyncpg.connect(base)
    try:
        await admin.execute(f'CREATE DATABASE "{name}" TEMPLATE "{template}"')
    finally:
        await admin.close()
    return name


def start(monkeypatch):
    """Returns (TestClient context manager, dsn, cleanup)."""
    import app.main as main_module
    from app.config import get_settings
    from app.services import email as email_service

    base = pg_support.require_postgres()
    if "name" not in _template:
        _template["name"] = _run(_migrated_template(base))
    name = _run(_clone(base, _template["name"]))
    dsn = pg_support.dsn_for(name, base)
    monkeypatch.setenv("DATABASE_URL", dsn)
    get_settings.cache_clear()

    async def no_background(pool, settings):
        return None

    outbox: list = []

    async def capture(mail, settings):
        outbox.append(mail)
        return True

    monkeypatch.setattr(main_module, "_start_background_task", no_background)
    monkeypatch.setattr(main_module, "_attach_error_log_handler", lambda pool: None)
    monkeypatch.setattr(email_service, "send_email", capture)
    test_client = TestClient(main_module.create_app())
    test_client.real_dsn = dsn
    test_client.outbox = outbox

    def cleanup():
        test_client.__exit__(None, None, None)
        _run(pg_support.drop_database(base, name))

    test_client.__enter__()
    return test_client, cleanup


def make_user(dsn: str, number: int, first_name: str, username: str | None, last_name: str | None) -> str:
    """A confirmed account with a live session, created straight in SQL. Returns the session token."""
    from app.security.tokens import generate_token, hash_token

    async def go() -> str:
        conn = await asyncpg.connect(dsn)
        try:
            email = f"user{number}@fixtures.example.com"
            row = await conn.fetchrow("SELECT id FROM users WHERE email = $1", email)
            if row is None:
                row = await conn.fetchrow(
                    "INSERT INTO users (email, email_verified_at, password_hash, first_name, last_name, username) "
                    "VALUES ($1, now(), 'x', $2, $3, $4) RETURNING id",
                    email, first_name, last_name, username or f"user{number}",
                )
            token = generate_token()
            await conn.execute(
                "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
                row["id"], hash_token(token), datetime.now(timezone.utc) + timedelta(days=30),
            )
            return token
        finally:
            await conn.close()

    return _run(go())
