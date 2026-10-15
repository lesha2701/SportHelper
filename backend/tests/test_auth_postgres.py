"""The account SQL against a real PostgreSQL: the 0031 migration on a database
that already holds Telegram-era users, DB-level uniqueness, atomic one-time
tokens, anonymisation, and the whole sign-up -> sign-in flow end to end.

The rest of the suite uses in-memory fakes; these tests are what proves the
fakes and the real SQL agree.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.config import DATABASE_DIR
from app.database import _discover_patches
from app.repositories import accounts as accounts_repo
from app.repositories import auth_tokens as tokens_repo
from app.repositories import sessions as sessions_repo
from app.repositories import users as users_repo
from app.security.tokens import generate_token, hash_token
from tests import pg_support

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _apply(conn: asyncpg.Connection, *, up_to: int | None = None, only: int | None = None) -> None:
    """Applies schema.sql (when starting from scratch) and numbered patches."""
    if only is None:
        await conn.execute((DATABASE_DIR / "schema.sql").read_text(encoding="utf-8"))
    for version, path in _discover_patches():
        if only is not None and version != only:
            continue
        if up_to is not None and version > up_to:
            break
        await conn.execute(path.read_text(encoding="utf-8"))
        await conn.execute("INSERT INTO schema_versions (version, name) VALUES ($1, $2)", version, path.name)


@pytest.fixture
async def pg():
    base = pg_support.require_postgres()
    name, dsn = await pg_support.create_database(base)
    try:
        yield dsn
    finally:
        await pg_support.drop_database(base, name)


@pytest.fixture
async def conn(pg):
    connection = await asyncpg.connect(pg)
    await _apply(connection)
    try:
        yield connection
    finally:
        await connection.close()


@pytest.fixture
async def pool(pg):
    seed = await asyncpg.connect(pg)
    await _apply(seed)
    await seed.close()
    created = await asyncpg.create_pool(pg, min_size=1, max_size=5)
    try:
        yield created
    finally:
        await created.close()


async def _user(conn, *, email: str | None = None, verified: bool = False, telegram_id: int | None = None, first_name: str = "Имя"):
    return await conn.fetchrow(
        "INSERT INTO users (email, email_verified_at, telegram_id, first_name, password_hash) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        email,
        _now() if verified else None,
        telegram_id,
        first_name,
        "hash" if email else None,
    )


# ------------------------------------------------------------------------------------------------
# The migration on a database that already has users
# ------------------------------------------------------------------------------------------------


async def test_migration_keeps_every_existing_user_and_their_data(pg) -> None:
    conn = await asyncpg.connect(pg)
    try:
        await _apply(conn, up_to=30)  # the database as it is in production today
        legacy = await conn.fetchrow(
            "INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (111, 'petr', 'Пётр', 'Петров') RETURNING *"
        )
        coach = await conn.fetchrow("INSERT INTO users (telegram_id, first_name) VALUES (222, 'Тренер') RETURNING id")
        await conn.execute("INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'Пётр', 'Теннис')", legacy["id"])
        await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'Тренер', 'Теннис')", coach["id"])
        team = await conn.fetchrow(
            "INSERT INTO teams (name, sport, status, created_by) VALUES ('Ястребы', 'Теннис', 'active', $1) RETURNING id", coach["id"]
        )
        await conn.execute("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'head_coach')", team["id"], coach["id"])
        await conn.execute("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'player')", team["id"], legacy["id"])
        before = await conn.fetchval("SELECT count(*) FROM users")

        await _apply(conn, only=31)

        assert await conn.fetchval("SELECT count(*) FROM users") == before == 2
        row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", legacy["id"])
        assert (row["telegram_id"], row["username"], row["first_name"], row["last_name"]) == (111, "petr", "Пётр", "Петров")
        # Not logged in, not verified, no password - and certainly no shared default password.
        assert row["email"] is None and row["email_verified_at"] is None and row["password_hash"] is None
        assert await conn.fetchval("SELECT count(*) FROM player_profiles WHERE user_id = $1", legacy["id"]) == 1
        assert await conn.fetchval("SELECT count(*) FROM team_members WHERE team_id = $1", team["id"]) == 2
        assert await conn.fetchval("SELECT count(*) FROM users WHERE password_hash IS NOT NULL") == 0
        assert await conn.fetchval("SELECT is_nullable FROM information_schema.columns "
                                   "WHERE table_name = 'users' AND column_name = 'telegram_id'") == "YES"
        # kept on purpose: the previous app version still uses it (rollback safety)
        assert await conn.fetchval("SELECT to_regclass('public.browser_login_tokens')") is not None
        assert await conn.fetchval("SELECT max(version) FROM schema_versions") == 31
    finally:
        await conn.close()


async def test_migration_is_safe_to_run_twice(pg) -> None:
    conn = await asyncpg.connect(pg)
    try:
        await _apply(conn, up_to=30)
        await conn.execute("INSERT INTO users (telegram_id, first_name) VALUES (1, 'A')")
        sql = next(path for version, path in _discover_patches() if version == 31).read_text(encoding="utf-8")

        await conn.execute(sql)
        await conn.execute(sql)  # a second run (e.g. a retried deploy) must not fail or change anything

        assert await conn.fetchval("SELECT count(*) FROM users") == 1
    finally:
        await conn.close()


async def test_a_fresh_database_gets_the_full_schema(conn) -> None:
    assert await conn.fetchval("SELECT max(version) FROM schema_versions") == _discover_patches()[-1][0]
    for table in ("user_sessions", "auth_tokens", "user_mfa"):
        assert await conn.fetchval("SELECT to_regclass($1)", f"public.{table}") is not None


# ------------------------------------------------------------------------------------------------
# Uniqueness is enforced by the database
# ------------------------------------------------------------------------------------------------


async def test_email_is_unique_in_the_database_case_insensitively(conn) -> None:
    await _user(conn, email="alice@example.com")

    with pytest.raises(asyncpg.UniqueViolationError):
        await _user(conn, email="alice@example.com")
    # Mixed case cannot even be stored (the application lower-cases first).
    with pytest.raises(asyncpg.CheckViolationError):
        await _user(conn, email="Alice@Example.com")
    # Accounts without an email (not yet migrated) don't collide with each other.
    await _user(conn, email=None, telegram_id=1)
    await _user(conn, email=None, telegram_id=2)
    # Another unique index still protects the Telegram identity.
    with pytest.raises(asyncpg.UniqueViolationError):
        await _user(conn, email=None, telegram_id=1)


async def test_create_with_password_reports_duplicates_as_unique_violations(conn) -> None:
    fields = dict(password_hash="$argon2id$x", first_name="A", last_name=None, preferred_role="coach", terms_version="v1")
    created = await users_repo.create_with_password(conn, email="a@example.com", **fields)

    assert created["email"] == "a@example.com" and created["email_verified_at"] is None
    assert created["terms_version"] == "v1" and created["preferred_role"] == "coach"
    assert "password_hash" not in created and created["has_password"] is True
    with pytest.raises(asyncpg.UniqueViolationError):
        await users_repo.create_with_password(conn, email="A@EXAMPLE.COM".lower(), **fields)
    assert (await users_repo.get_by_email(conn, "A@Example.com"))["id"] == created["id"]


async def test_restart_registration_only_touches_unverified_web_accounts(conn) -> None:
    unverified = await users_repo.create_with_password(
        conn, email="u@example.com", password_hash="old", first_name="Old", last_name=None, preferred_role=None, terms_version="v1"
    )
    verified = await _user(conn, email="v@example.com", verified=True)
    legacy = await _user(conn, email="l@example.com", telegram_id=5)
    kw = dict(password_hash="new", first_name="New", last_name=None, preferred_role="player", terms_version="v2")

    assert (await users_repo.restart_unverified_registration(conn, unverified["id"], **kw))["first_name"] == "New"
    assert await users_repo.restart_unverified_registration(conn, verified["id"], **kw) is None
    assert await users_repo.restart_unverified_registration(conn, legacy["id"], **kw) is None


async def test_login_failures_lock_the_account_in_sql(conn) -> None:
    user = await _user(conn, email="a@example.com", verified=True)

    results = [await users_repo.register_login_failure(conn, user["id"], max_failures=3, lockout_minutes=15) for _ in range(3)]

    assert results[0] is None and results[1] is None and results[2] is not None
    assert results[2] > _now() + timedelta(minutes=14)
    creds = await users_repo.get_credentials_by_email(conn, "a@example.com")
    assert creds["failed_login_count"] == 0 and creds["locked_until"] == results[2]
    await users_repo.clear_login_failures(conn, user["id"])
    assert (await users_repo.get_credentials_by_email(conn, "a@example.com"))["locked_until"] is None


# ------------------------------------------------------------------------------------------------
# Sessions
# ------------------------------------------------------------------------------------------------


async def test_session_lifecycle_and_ownership_in_sql(conn) -> None:
    alice = await _user(conn, email="a@example.com", verified=True)
    bob = await _user(conn, email="b@example.com", verified=True)
    token = generate_token()
    row = await sessions_repo.create(conn, user_id=alice["id"], token_hash=hash_token(token), expires_at=_now() + timedelta(days=1),
                                     user_agent="Mozilla/5.0 Chrome/120 Safari/537", ip_address="203.0.113.7")

    assert (await sessions_repo.get_active(conn, hash_token(token)))["user_id"] == alice["id"]
    assert await sessions_repo.get_active(conn, hash_token("other")) is None
    assert await sessions_repo.revoke(conn, bob["id"], row["id"]) is False  # not Bob's session
    assert await sessions_repo.get_active(conn, hash_token(token)) is not None
    assert len(await sessions_repo.list_for_user(conn, alice["id"])) == 1 and await sessions_repo.list_for_user(conn, bob["id"]) == []

    await sessions_repo.touch(conn, row["id"], alice["id"], _now() + timedelta(days=2))
    assert await conn.fetchval("SELECT last_login_at IS NOT NULL FROM users WHERE id = $1", alice["id"])

    assert await sessions_repo.revoke(conn, alice["id"], row["id"]) is True
    assert await sessions_repo.get_active(conn, hash_token(token)) is None
    assert await sessions_repo.revoke(conn, alice["id"], row["id"]) is False  # already gone


async def test_expired_sessions_are_inactive_and_purged(conn) -> None:
    user = await _user(conn, email="a@example.com", verified=True)
    token = generate_token()
    await sessions_repo.create(conn, user_id=user["id"], token_hash=hash_token(token), expires_at=_now() - timedelta(seconds=1),
                               user_agent=None, ip_address=None)

    assert await sessions_repo.get_active(conn, hash_token(token)) is None
    assert await sessions_repo.purge_expired(conn) == 1


async def test_revoke_all_can_spare_one_session(conn) -> None:
    user = await _user(conn, email="a@example.com", verified=True)
    rows = [
        await sessions_repo.create(conn, user_id=user["id"], token_hash=hash_token(str(i)), expires_at=_now() + timedelta(days=1),
                                   user_agent=None, ip_address=None)
        for i in range(3)
    ]

    assert await sessions_repo.revoke_all(conn, user["id"], except_session_id=rows[0]["id"]) == 2
    assert [r["id"] for r in await sessions_repo.list_for_user(conn, user["id"])] == [rows[0]["id"]]
    assert await sessions_repo.revoke_all(conn, user["id"]) == 1


# ------------------------------------------------------------------------------------------------
# One-time tokens
# ------------------------------------------------------------------------------------------------


async def test_a_token_can_be_spent_exactly_once_even_under_concurrency(pool) -> None:
    async with pool.acquire() as conn:
        user = await _user(conn, email="a@example.com")
        await tokens_repo.create(conn, user_id=user["id"], purpose="password_reset", token_hash=hash_token("t"),
                                 expires_at=_now() + timedelta(minutes=30))

    async def spend():
        async with pool.acquire() as c:
            return await tokens_repo.consume(c, hash_token("t"), "password_reset")

    results = await asyncio.gather(*[spend() for _ in range(8)])

    assert sum(r is not None for r in results) == 1


async def test_tokens_are_bound_to_their_purpose_expire_and_supersede(conn) -> None:
    user = await _user(conn, email="a@example.com")
    await tokens_repo.create(conn, user_id=user["id"], purpose="email_verify", token_hash=hash_token("v1"),
                             expires_at=_now() + timedelta(hours=1), new_email="a@example.com")

    assert await tokens_repo.consume(conn, hash_token("v1"), "password_reset") is None  # wrong purpose
    await tokens_repo.create(conn, user_id=user["id"], purpose="email_verify", token_hash=hash_token("v2"),
                             expires_at=_now() + timedelta(hours=1), new_email="a@example.com")
    assert await tokens_repo.consume(conn, hash_token("v1"), "email_verify") is None  # superseded
    await tokens_repo.create(conn, user_id=user["id"], purpose="password_reset", token_hash=hash_token("old"),
                             expires_at=_now() - timedelta(seconds=1))
    assert await tokens_repo.consume(conn, hash_token("old"), "password_reset") is None  # expired
    assert (await tokens_repo.consume(conn, hash_token("v2"), "email_verify"))["new_email"] == "a@example.com"
    assert await tokens_repo.consume(conn, hash_token("v2"), "email_verify") is None  # spent


# ------------------------------------------------------------------------------------------------
# Composite operations
# ------------------------------------------------------------------------------------------------


async def test_verify_email_sets_the_address_atomically(conn) -> None:
    user = await users_repo.create_with_password(
        conn, email="a@example.com", password_hash="h", first_name="A", last_name=None, preferred_role=None, terms_version="v1"
    )
    await tokens_repo.create(conn, user_id=user["id"], purpose="email_verify", token_hash=hash_token("t"),
                             expires_at=_now() + timedelta(hours=1), new_email="a@example.com")

    status, verified = await accounts_repo.verify_email(conn, hash_token("t"))

    assert status == "ok" and verified["email_verified_at"] is not None
    assert (await accounts_repo.verify_email(conn, hash_token("t")))[0] == "invalid"


async def test_reset_password_changes_the_hash_and_revokes_every_session(conn) -> None:
    user = await _user(conn, email="a@example.com", verified=True)
    await sessions_repo.create(conn, user_id=user["id"], token_hash=hash_token("s"), expires_at=_now() + timedelta(days=1),
                               user_agent=None, ip_address=None)
    await tokens_repo.create(conn, user_id=user["id"], purpose="password_reset", token_hash=hash_token("r"),
                             expires_at=_now() + timedelta(minutes=30))

    result = await accounts_repo.reset_password(conn, hash_token("r"), "NEWHASH")

    assert result["id"] == user["id"]
    assert await users_repo.get_password_hash(conn, user["id"]) == "NEWHASH"
    assert await sessions_repo.get_active(conn, hash_token("s")) is None
    assert await accounts_repo.reset_password(conn, hash_token("r"), "AGAIN") is None
    assert await users_repo.get_password_hash(conn, user["id"]) == "NEWHASH"


async def test_email_change_cannot_steal_an_address_taken_in_the_meantime(conn) -> None:
    user = await _user(conn, email="old@example.com", verified=True)
    await tokens_repo.create(conn, user_id=user["id"], purpose="email_change", token_hash=hash_token("c"),
                             expires_at=_now() + timedelta(hours=1), new_email="wanted@example.com")
    await _user(conn, email="wanted@example.com", verified=True)

    status, _, _ = await accounts_repo.confirm_email_change(conn, hash_token("c"))

    assert status == "email_taken"
    assert (await users_repo.get_by_id(conn, user["id"]))["email"] == "old@example.com"
    # The failed attempt rolled back, so the token was not burnt.
    assert await tokens_repo.peek(conn, hash_token("c"), "email_change") is not None


async def test_claiming_a_legacy_account_in_sql_keeps_id_and_defers_the_email(conn) -> None:
    legacy = await _user(conn, telegram_id=777, first_name="Пётр")
    await conn.execute("INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'Пётр', 'Теннис')", legacy["id"])
    await tokens_repo.create(conn, user_id=legacy["id"], purpose="telegram_claim", token_hash=hash_token("claim"),
                             expires_at=_now() + timedelta(minutes=30))

    status, _ = await accounts_repo.claim_account(
        conn, claim_token_hash=hash_token("claim"), email="petr@example.com", password_hash="PH", terms_version="v1",
        verify_token_hash=hash_token("verify"), verify_expires_at=_now() + timedelta(hours=1),
    )

    assert status == "ok"
    row = await conn.fetchrow("SELECT email, password_hash, telegram_id FROM users WHERE id = $1", legacy["id"])
    assert row["email"] is None and row["password_hash"] == "PH" and row["telegram_id"] == 777
    assert await tokens_repo.peek(conn, hash_token("claim"), "telegram_claim") is None  # spent

    status, user = await accounts_repo.verify_email(conn, hash_token("verify"))
    assert status == "ok" and user["id"] == legacy["id"] and user["email"] == "petr@example.com"
    assert await conn.fetchval("SELECT count(*) FROM player_profiles WHERE user_id = $1", legacy["id"]) == 1
    assert await conn.fetchval("SELECT count(*) FROM users") == 1


async def test_claim_refuses_an_address_that_is_already_registered(conn) -> None:
    await _user(conn, email="taken@example.com", verified=True)
    legacy = await _user(conn, telegram_id=1)
    await tokens_repo.create(conn, user_id=legacy["id"], purpose="telegram_claim", token_hash=hash_token("c"),
                             expires_at=_now() + timedelta(minutes=30))

    status, _ = await accounts_repo.claim_account(
        conn, claim_token_hash=hash_token("c"), email="taken@example.com", password_hash="PH", terms_version="v1",
        verify_token_hash=hash_token("v"), verify_expires_at=_now() + timedelta(hours=1),
    )

    assert status == "email_taken"
    assert await tokens_repo.peek(conn, hash_token("c"), "telegram_claim") is not None  # still usable


async def test_link_telegram_never_takes_over_another_users_telegram(conn) -> None:
    await _user(conn, email="owner@example.com", verified=True, telegram_id=42)
    other = await _user(conn, email="other@example.com", verified=True)
    await tokens_repo.create(conn, user_id=other["id"], purpose="telegram_link", token_hash=hash_token("l"),
                             expires_at=_now() + timedelta(minutes=30))

    assert (await accounts_repo.link_telegram(conn, hash_token("l"), 42, "x"))[0] == "telegram_taken"
    assert (await accounts_repo.link_telegram(conn, hash_token("l"), 43, "x"))[0] == "ok"
    assert (await users_repo.get_by_id(conn, other["id"]))["telegram_id"] == 43


async def test_anonymising_erases_personal_data_but_destroys_no_shared_history(conn) -> None:
    coach = await _user(conn, email="c@example.com", verified=True, telegram_id=9, first_name="Тренер")
    await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport, description) VALUES ($1, 'Тренер Иванов', 'Теннис', 'о себе')", coach["id"])
    listing = await conn.fetchrow("INSERT INTO coach_listings (coach_user_id, title, is_listed) VALUES ($1, 'Занятия', TRUE) RETURNING id", coach["id"])
    team = await conn.fetchrow(
        "INSERT INTO teams (name, sport, status, created_by) VALUES ('Ястребы', 'Теннис', 'active', $1) RETURNING id", coach["id"]
    )
    await conn.execute("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'head_coach')", team["id"], coach["id"])
    await sessions_repo.create(conn, user_id=coach["id"], token_hash=hash_token("s"), expires_at=_now() + timedelta(days=1),
                               user_agent=None, ip_address=None)

    await users_repo.anonymize(conn, coach["id"])

    row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", coach["id"])
    assert row["email"] is None and row["password_hash"] is None and row["telegram_id"] is None
    assert row["first_name"] == "Удалённый пользователь" and row["deleted_at"] is not None
    # Nothing was cascade-deleted:
    assert await conn.fetchval("SELECT count(*) FROM coach_listings WHERE id = $1", listing["id"]) == 1
    assert await conn.fetchval("SELECT is_listed FROM coach_listings WHERE id = $1", listing["id"]) is False
    assert await conn.fetchval("SELECT full_name FROM coach_profiles WHERE user_id = $1", coach["id"]) == "Удалённый пользователь"
    assert await conn.fetchval("SELECT description FROM coach_profiles WHERE user_id = $1", coach["id"]) is None
    assert await conn.fetchval("SELECT count(*) FROM team_members WHERE user_id = $1", coach["id"]) == 1
    assert await conn.fetchval("SELECT count(*) FROM user_sessions WHERE user_id = $1", coach["id"]) == 0


async def test_users_due_for_deletion_respect_the_grace_period(conn) -> None:
    old = await _user(conn, email="old@example.com", verified=True)
    recent = await _user(conn, email="recent@example.com", verified=True)
    await conn.execute("UPDATE users SET deletion_requested_at = now() - interval '20 days' WHERE id = $1", old["id"])
    await users_repo.request_deletion(conn, recent["id"])

    due = await users_repo.list_due_for_deletion(conn, older_than=_now() - timedelta(days=14))

    assert due == [old["id"]]
    await users_repo.cancel_deletion(conn, old["id"])
    assert await users_repo.list_due_for_deletion(conn, older_than=_now() - timedelta(days=14)) == []


# ------------------------------------------------------------------------------------------------
# The whole HTTP flow against the real database
# ------------------------------------------------------------------------------------------------


@pytest.fixture
def live_client(pg, monkeypatch):
    """The real app (real pool, real migrations, real repositories) - only the
    background loop and outgoing mail are replaced."""
    from app.config import get_settings
    from app.services import email as email_service
    import app.main as main_module

    monkeypatch.setenv("DATABASE_URL", pg)
    monkeypatch.setenv("JWT_SECRET", "live-secret")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:5173")
    monkeypatch.setenv("ARGON2_MEMORY_KIB", "64")
    monkeypatch.setenv("ARGON2_TIME_COST", "1")
    monkeypatch.setenv("ARGON2_PARALLELISM", "1")
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "TestBot")
    monkeypatch.setenv("SMTP_HOST", "")
    for name in ("COOKIE_SECURE", "ADMIN_EMAILS"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()

    async def no_background(pool, settings):
        return None

    monkeypatch.setattr(main_module, "_start_background_task", no_background)
    monkeypatch.setattr(main_module, "_attach_error_log_handler", lambda pool: None)
    outbox = []

    async def capture(mail, settings):
        outbox.append(mail)
        return True

    monkeypatch.setattr(email_service, "send_email", capture)
    with TestClient(main_module.create_app()) as client:
        client.outbox = outbox
        yield client
    get_settings.cache_clear()


def test_full_account_lifecycle_over_http_with_real_sql(live_client) -> None:
    from tests.auth_helpers import PASSWORD, csrf_headers, link_token, login, register

    client = live_client
    assert register(client).status_code == 201
    assert register(client, email="ALICE@example.com", first_name="Другая").status_code == 201  # replaces the unconfirmed attempt
    assert login(client).status_code == 403  # not confirmed yet

    token = link_token(client.outbox[-1])
    assert client.post("/api/auth/verify-email", json={"token": token, "password": PASSWORD}).status_code == 200
    assert client.post("/api/auth/verify-email", json={"token": token, "password": PASSWORD}).status_code == 400

    signed_in = login(client)
    assert signed_in.status_code == 200
    csrf = signed_in.json()["csrf_token"]
    assert client.get("/api/auth/me").json()["first_name"] == "Другая"
    assert client.post("/api/profile/active-mode", json={"mode": "player"}).status_code == 403  # no CSRF header
    assert client.post("/api/profile/active-mode", json={"mode": "player"}, headers=csrf_headers(csrf)).status_code == 409

    second = login(client)
    assert len(client.get("/api/auth/sessions").json()) == 2
    assert client.post("/api/auth/logout-all", headers=csrf_headers(second.json()["csrf_token"])).status_code == 200
    assert client.get("/api/auth/me").status_code == 401

    # password recovery end to end
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    reset_token = link_token(client.outbox[-1])
    new_password = "a completely new passphrase"
    ok = client.post("/api/auth/reset-password", json={"token": reset_token, "password": new_password, "password_confirm": new_password})
    assert ok.status_code == 200
    assert login(client, password=PASSWORD).status_code == 401
    assert login(client, password=new_password).status_code == 200


def test_telegram_era_user_moves_to_email_end_to_end_with_real_sql(pg, live_client) -> None:
    from app.services import claim as claim_service
    from app.config import get_settings
    from tests.auth_helpers import PASSWORD, link_token, login

    client = live_client

    async def seed_and_issue():
        conn = await asyncpg.connect(pg)
        try:
            legacy = await conn.fetchrow("INSERT INTO users (telegram_id, first_name) VALUES (777, 'Пётр') RETURNING id")
            await conn.execute("INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'Пётр П', 'Теннис')", legacy["id"])
            user = await users_repo.get_by_id(conn, legacy["id"])
            return legacy["id"], await claim_service.issue_claim_token(conn, user, get_settings())
        finally:
            await conn.close()

    legacy_id, token = asyncio.run(seed_and_issue())
    assert client.post("/api/auth/claim/inspect", json={"token": token}).json()["valid"] is True
    body = {"token": token, "email": "petr@example.com", "password": PASSWORD, "password_confirm": PASSWORD, "accept_terms": True}
    assert client.post("/api/auth/claim", json=body).status_code == 200
    assert login(client, email="petr@example.com").status_code == 401  # confirm the address first
    assert client.post("/api/auth/verify-email", json={"token": link_token(client.outbox[-1]), "password": PASSWORD}).status_code == 200

    signed_in = login(client, email="petr@example.com")
    assert signed_in.status_code == 200 and signed_in.json()["id"] == str(legacy_id)
    assert client.get("/api/profile/me").json()["player"]["full_name"] == "Пётр П"
    assert client.post("/api/auth/claim", json=body).status_code == 400  # the link is spent


async def test_create_user_script_upserts_against_the_partial_unique_index(pg, monkeypatch) -> None:
    import runpy
    import sys

    from app.config import get_settings

    monkeypatch.setenv("DATABASE_URL", pg)
    monkeypatch.setenv("CREATE_USER_PASSWORD", "a long throwaway passphrase")
    monkeypatch.setenv("ARGON2_MEMORY_KIB", "64")
    monkeypatch.setenv("ARGON2_TIME_COST", "1")
    monkeypatch.setenv("ARGON2_PARALLELISM", "1")
    get_settings.cache_clear()

    def run(*argv: str) -> int:
        monkeypatch.setattr(sys, "argv", ["create_user.py", *argv])
        module = runpy.run_path(str(DATABASE_DIR.parent / "backend" / "scripts" / "create_user.py"), run_name="not_main")
        return asyncio.run(module["main"]())

    # (asyncio.run inside a running test loop is not allowed, so run it in a thread)
    results = await asyncio.get_running_loop().run_in_executor(None, lambda: (run("Dev@Example.com", "Dev"), run("dev@example.com", "Dev")))
    assert results == (0, 0)
    check = await asyncpg.connect(pg)
    try:
        rows = await check.fetch("SELECT email, email_verified_at, password_hash FROM users")
    finally:
        await check.close()
    assert len(rows) == 1 and rows[0]["email"] == "dev@example.com"
    assert rows[0]["email_verified_at"] is not None and rows[0]["password_hash"].startswith("$argon2id$")
    get_settings.cache_clear()


# ------------------------------------------------------------------------------------------------
# 0032: shared rate limits, external identities, admin audit
# ------------------------------------------------------------------------------------------------


async def test_rate_limit_allows_exactly_the_limit_even_when_requests_race_on_many_connections(pool) -> None:
    from app.repositories import rate_limits

    async def attempt():
        async with pool.acquire() as c:
            return await rate_limits.hit(c, "login-email:victim@example.com", 5, 60)

    results = await asyncio.gather(*[attempt() for _ in range(25)])

    assert sum(1 for allowed, _ in results if allowed) == 5
    assert all(retry >= 1 for allowed, retry in results if not allowed)


async def test_rate_limit_is_per_key_and_recovers_when_the_window_passes(conn) -> None:
    from app.repositories import rate_limits

    assert [(await rate_limits.hit(conn, "a", 2, 60))[0] for _ in range(3)] == [True, True, False]
    assert (await rate_limits.hit(conn, "b", 2, 60))[0] is True  # another key is unaffected
    await conn.execute("UPDATE rate_limit_hits SET hit_at = now() - interval '2 minutes' WHERE key = 'a'")
    assert (await rate_limits.hit(conn, "a", 2, 60))[0] is True  # old hits no longer count
    assert await rate_limits.purge_old(conn, older_than_seconds=1) >= 1


async def test_denied_attempts_are_not_recorded_so_hammering_does_not_extend_the_lock(conn) -> None:
    from app.repositories import rate_limits

    for _ in range(10):
        await rate_limits.hit(conn, "k", 3, 60)

    assert await conn.fetchval("SELECT count(*) FROM rate_limit_hits WHERE key = 'k'") == 3


def test_the_limits_hold_across_two_backend_processes_sharing_one_database(pg, monkeypatch) -> None:
    """Two independent app instances (as with `--workers 2` or two containers) share
    nothing in memory; the only shared state is PostgreSQL."""
    import app.main as main_module
    from app.config import get_settings
    from app.services import email as email_service

    monkeypatch.setenv("DATABASE_URL", pg)
    monkeypatch.setenv("JWT_SECRET", "two-process-secret")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173")
    monkeypatch.setenv("ARGON2_MEMORY_KIB", "64")
    monkeypatch.setenv("ARGON2_TIME_COST", "1")
    monkeypatch.setenv("ARGON2_PARALLELISM", "1")
    monkeypatch.setenv("AUTH_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("SMTP_HOST", "")
    get_settings.cache_clear()

    async def no_background(pool, settings):
        return None

    async def no_mail(mail, settings):
        return True

    monkeypatch.setattr(main_module, "_start_background_task", no_background)
    monkeypatch.setattr(main_module, "_attach_error_log_handler", lambda pool: None)
    monkeypatch.setattr(email_service, "send_email", no_mail)

    with TestClient(main_module.create_app()) as one, TestClient(main_module.create_app()) as two:
        codes = []
        for n in range(14):
            target = one if n % 2 == 0 else two  # the attacker alternates between the two processes
            codes.append(target.post("/api/auth/login", json={"email": "victim@example.com", "password": f"guess {n}"}).status_code)

    assert codes[:10] == [401] * 10  # the per-address budget (10) was shared by both processes
    assert codes[10:] == [429] * 4


async def test_external_accounts_belong_to_one_user_and_one_per_provider(conn) -> None:
    from app.repositories import identities

    alice = await _user(conn, email="a@example.com", verified=True)
    bob = await _user(conn, email="b@example.com", verified=True)

    ok, row = await identities.link(conn, user_id=alice["id"], provider="yandex", provider_user_id="Y-1",
                                    provider_email="a@yandex.ru", provider_email_verified=True, display_name="Алиса")
    assert ok == "ok" and row["provider"] == "yandex"
    # the same Yandex account cannot be attached to a second website account
    assert (await identities.link(conn, user_id=bob["id"], provider="yandex", provider_user_id="Y-1", provider_email=None,
                                  provider_email_verified=False, display_name=None))[0] == "external_taken"
    # a user can't attach a second Yandex account...
    assert (await identities.link(conn, user_id=alice["id"], provider="yandex", provider_user_id="Y-2", provider_email=None,
                                  provider_email_verified=False, display_name=None))[0] == "provider_taken"
    # ...but can add a different provider
    assert (await identities.link(conn, user_id=alice["id"], provider="vk", provider_user_id="Y-1", provider_email=None,
                                  provider_email_verified=False, display_name=None))[0] == "ok"
    assert {i["provider"] for i in await identities.list_for_user(conn, alice["id"])} == {"yandex", "vk"}


async def test_provider_slug_must_be_well_formed_so_junk_cannot_be_stored(conn) -> None:
    user = await _user(conn, email="a@example.com", verified=True)

    for bad in ("", "Yandex", "ya ndex", "'; drop", "x" * 40, "1abc"):
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute("INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1, $2, 'x')", user["id"], bad)


async def test_identities_are_removed_with_the_user_and_on_anonymisation(conn) -> None:
    from app.repositories import identities

    gone = await _user(conn, email="gone@example.com", verified=True)
    await identities.link(conn, user_id=gone["id"], provider="vk", provider_user_id="V-9", provider_email=None,
                          provider_email_verified=False, display_name=None)

    await users_repo.anonymize(conn, gone["id"])

    assert await conn.fetchval("SELECT count(*) FROM user_identities WHERE user_id = $1", gone["id"]) == 0
    assert await identities.get_by_external(conn, "vk", "V-9") is None  # the external account is free again


async def test_sign_in_rules_for_external_providers(conn) -> None:
    from app.repositories import identities
    from app.services import identities as service
    from app.services.identities import ExternalProfile, SignInOutcome

    owner = await users_repo.create_with_password(conn, email="owner@example.com", password_hash="h", first_name="Owner",
                                                  last_name=None, preferred_role=None, terms_version="v1")
    await conn.execute("UPDATE users SET email_verified_at = now() WHERE id = $1", owner["id"])

    # an unknown provider is refused outright
    with pytest.raises(service.UnsupportedProvider):
        await service.decide_sign_in(conn, ExternalProfile("facebook", "1"))

    # a provider email that matches an existing account NEVER auto-links, however "verified" it claims to be
    decision = await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-1", "owner@example.com", True))
    assert decision.outcome is SignInOutcome.LINK_REQUIRED and decision.user is None

    # a brand-new person with a trusted, verified provider email may create an account
    assert (await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-2", "new@example.com", True))).outcome is SignInOutcome.CREATE_ACCOUNT
    # ...but not when the provider isn't trusted for emails, or the email isn't verified, or is absent
    assert (await service.decide_sign_in(conn, ExternalProfile("vk", "V-2", "new@example.com", True))).outcome is SignInOutcome.EMAIL_REQUIRED
    assert (await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-3", "new@example.com", False))).outcome is SignInOutcome.EMAIL_REQUIRED
    assert (await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-4"))).outcome is SignInOutcome.EMAIL_REQUIRED

    # after the owner links it from a signed-in session, that external account signs them in
    assert await service.link_identity(conn, owner["id"], ExternalProfile("yandex", "Y-1", "owner@example.com", True)) == "ok"
    known = await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-1"))
    assert known.outcome is SignInOutcome.SIGN_IN and known.user["id"] == owner["id"]

    # banned and deleted users cannot sign in this way either
    await conn.execute("UPDATE users SET is_banned = TRUE WHERE id = $1", owner["id"])
    with pytest.raises(PermissionError):
        await service.decide_sign_in(conn, ExternalProfile("yandex", "Y-1"))
    assert await identities.get_by_external(conn, "yandex", "Y-1") is not None


async def test_the_last_way_to_sign_in_cannot_be_unlinked(conn) -> None:
    from app.services import identities as service
    from app.services.identities import ExternalProfile

    only_provider = await _user(conn, email="p@example.com", verified=True)
    await conn.execute("UPDATE users SET password_hash = NULL WHERE id = $1", only_provider["id"])
    await service.link_identity(conn, only_provider["id"], ExternalProfile("yandex", "Y-1"))
    user = await users_repo.get_by_id(conn, only_provider["id"])
    assert user["has_password"] is False

    assert await service.unlink_identity(conn, user, "yandex") == "last_login_method"
    await service.link_identity(conn, only_provider["id"], ExternalProfile("vk", "V-1"))
    assert await service.unlink_identity(conn, user, "yandex") == "ok"  # VK remains
    assert await service.unlink_identity(conn, user, "vk") == "last_login_method"
    assert await service.unlink_identity(conn, user, "yandex") == "not_found"

    with_password = await users_repo.get_by_id(conn, (await _user(conn, email="q@example.com", verified=True))["id"])
    await service.link_identity(conn, with_password["id"], ExternalProfile("vk", "V-2"))
    assert await service.unlink_identity(conn, with_password, "vk") == "ok"  # the password remains


async def test_admin_actions_are_audited_by_account_and_bans_end_sessions_in_sql(conn) -> None:
    from app.repositories import admin as admin_repo

    boss = await _user(conn, email="boss@example.com", verified=True)
    victim = await _user(conn, email="v@example.com", verified=True)
    await sessions_repo.create(conn, user_id=victim["id"], token_hash=hash_token("v"), expires_at=_now() + timedelta(days=1),
                               user_agent=None, ip_address=None)

    banned = await admin_repo.set_banned_by_id(conn, victim["id"], True)
    await admin_repo.record_audit(conn, admin_user_id=boss["id"], action="ban", target_type="user", target_id=str(victim["id"]),
                                  details={"reason": "spam"})
    await admin_repo.record_audit(conn, admin_telegram_id=12345, action="ban")  # the bot's way still works

    assert banned["is_banned"] is True
    assert await sessions_repo.get_active(conn, hash_token("v")) is None
    entries = await admin_repo.list_audit(conn, limit=10, offset=0)
    assert {e["admin_email"] for e in entries} == {"boss@example.com", None}
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute("INSERT INTO admin_audit_log (action) VALUES ('anonymous action')")  # an actor is required
    page = await admin_repo.list_web_users(conn, limit=10, offset=0, query="v@ex")
    assert [u["email"] for u in page] == ["v@example.com"] and await admin_repo.count_web_users(conn, "boss") == 1
    assert await admin_repo.count_web_users(conn, "100%") == 0  # LIKE wildcards in the search are escaped


def test_admin_api_with_real_sql_requires_the_second_factor_per_session(live_client, monkeypatch) -> None:
    from app.config import get_settings
    from app.security import totp
    from tests.auth_helpers import PASSWORD, csrf_headers, link_token, login, register

    monkeypatch.setenv("ADMIN_EMAILS", "boss@example.com")
    get_settings.cache_clear()
    client = live_client
    for email in ("boss@example.com", "victim@example.com"):
        assert register(client, email=email, first_name=email.split("@")[0]).status_code == 201
        assert client.post("/api/auth/verify-email", json={"token": link_token(client.outbox[-1]), "password": PASSWORD}).status_code == 200

    csrf = login(client, email="boss@example.com").json()["csrf_token"]
    assert client.get("/api/admin/overview").status_code == 200
    assert client.get("/api/admin/users").json()["error"]["code"] == "mfa_setup_required"

    secret = client.post("/api/auth/mfa/setup", headers=csrf_headers(csrf)).json()["secret"]
    assert client.post("/api/auth/mfa/enable", headers=csrf_headers(csrf), json={"code": totp._hotp(secret, totp.current_step())}).status_code == 200
    users = client.get("/api/admin/users")
    assert users.status_code == 200 and users.json()["total"] == 2
    victim_id = next(u["id"] for u in users.json()["items"] if u["email"] == "victim@example.com")

    client.cookies.clear()  # a new session with the right password but no code
    csrf2 = login(client, email="boss@example.com").json()["csrf_token"]
    assert client.get("/api/admin/users").json()["error"]["code"] == "mfa_required"
    assert client.post(f"/api/admin/users/{victim_id}/ban", headers=csrf_headers(csrf2)).status_code == 403

    assert client.post("/api/auth/mfa/verify", headers=csrf_headers(csrf2), json={"code": totp._hotp(secret, totp.current_step() + 1)}).status_code == 200
    assert client.post(f"/api/admin/users/{victim_id}/ban", headers=csrf_headers(csrf2)).json()["is_banned"] is True
    audit = client.get("/api/admin/audit").json()
    assert audit[0]["action"] == "ban" and audit[0]["admin"] == "boss@example.com" and audit[0]["target_id"] == victim_id


async def test_migration_0032_keeps_existing_audit_rows_and_is_safe_to_run_twice(pg) -> None:
    conn = await asyncpg.connect(pg)
    try:
        await _apply(conn, up_to=31)
        await conn.execute("INSERT INTO users (email, email_verified_at, first_name) VALUES ('a@example.com', now(), 'A')")
        await conn.execute("INSERT INTO admin_audit_log (admin_telegram_id, action, target_id) VALUES (777, 'ban', '42')")
        before = await conn.fetchval("SELECT count(*) FROM users")

        await _apply(conn, only=32)
        sql = next(path for version, path in _discover_patches() if version == 32).read_text(encoding="utf-8")
        await conn.execute(sql)  # a retried deploy
        await conn.execute(sql)

        assert await conn.fetchval("SELECT count(*) FROM users") == before == 1
        row = await conn.fetchrow("SELECT admin_telegram_id, admin_user_id, action FROM admin_audit_log")
        assert (row["admin_telegram_id"], row["admin_user_id"], row["action"]) == (777, None, "ban")
        for table in ("user_identities", "rate_limit_hits"):
            assert await conn.fetchval("SELECT to_regclass($1)", f"public.{table}") is not None
    finally:
        await conn.close()


def test_pre_registered_address_cannot_be_activated_with_the_attackers_password_real_sql(live_client) -> None:
    from tests.auth_helpers import OTHER_PASSWORD, PASSWORD, link_token, login, register

    client = live_client
    attacker_password = "attacker chosen passphrase"
    assert register(client, email="victim@example.com", password=attacker_password, first_name="Attacker").status_code == 201
    token = link_token(client.outbox[-1])

    assert client.post("/api/auth/verify-email", json={"token": token, "password": "something else entirely"}).status_code == 403
    assert login(client, email="victim@example.com", password=attacker_password).status_code == 403  # still unconfirmed

    done = client.post("/api/auth/verify-email/set-password",
                       json={"token": token, "password": OTHER_PASSWORD, "password_confirm": OTHER_PASSWORD})
    assert done.status_code == 200
    assert login(client, email="victim@example.com", password=attacker_password).status_code == 401
    assert login(client, email="victim@example.com", password=OTHER_PASSWORD).status_code == 200
    # the registration password is still accepted for the person who really registered
    assert register(client, email="real@example.com").status_code == 201
    assert client.post("/api/auth/verify-email", json={"token": link_token(client.outbox[-1]), "password": PASSWORD}).status_code == 200


async def test_two_processes_starting_at_once_migrate_a_fresh_database_without_clashing(pg) -> None:
    """The backend and the bot container boot together and both run the migrations."""
    from app.config import Settings
    from app.database import create_pool, run_migrations

    settings = Settings(_env_file=None, DATABASE_URL=pg)
    pools = [await create_pool(settings) for _ in range(4)]
    try:
        await asyncio.gather(*[run_migrations(p) for p in pools])  # must not raise (no duplicate-version crash)
        async with pools[0].acquire() as conn:
            versions = [r["version"] for r in await conn.fetch("SELECT version FROM schema_versions ORDER BY version")]
    finally:
        for p in pools:
            await p.close()

    assert versions == sorted(set(versions)) and versions[-1] == _discover_patches()[-1][0] and len(versions) == len(_discover_patches()) + 1


async def test_migrations_on_a_large_production_sized_users_table_are_fast_and_non_destructive(pg) -> None:
    """0031/0032 on 300k existing users: no table rewrite, nothing lost, seconds not minutes."""
    import time

    conn = await asyncpg.connect(pg)
    try:
        await _apply(conn, up_to=30)
        await conn.execute(
            "INSERT INTO users (telegram_id, first_name, username) "
            "SELECT 10000000 + g, 'U' || g, 'u' || g FROM generate_series(1, 300000) g"
        )
        started = time.monotonic()
        await _apply(conn, only=31)
        await _apply(conn, only=32)
        elapsed = time.monotonic() - started

        assert await conn.fetchval("SELECT count(*) FROM users") == 300000
        assert await conn.fetchval("SELECT count(*) FROM users WHERE email IS NOT NULL OR password_hash IS NOT NULL") == 0
        assert await conn.fetchval("SELECT min(failed_login_count) FROM users") == 0
        assert elapsed < 20, f"migrations took {elapsed:.1f}s on 300k users"
    finally:
        await conn.close()
