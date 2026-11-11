"""Confirming a booked session (migration 0045) against a real PostgreSQL: the tables, their rules and the repositories (TR-03, TR-04).

What the database itself refuses is proved here, whatever the application does: the window closes once, confirming and disputing exclude each
other, an automatic confirmation has no author, a dispute and its resolution are complete, and a verified code is never replaced."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.core import session_time
from app.repositories import session_codes as codes
from app.repositories import session_confirmations as confirmations
from app.security import session_codes as code_security
from tests.test_auth_postgres import conn, pg  # noqa: F401  (fixtures)

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")
SECRET = "test-secret-for-session-codes-0123456789"


async def _user(conn: asyncpg.Connection, name: str) -> UUID:
    return (await conn.fetchrow(
        "INSERT INTO users (email, email_verified_at, first_name, password_hash) VALUES ($1, now(), $2, 'hash') RETURNING id",
        f"user-{uuid4().hex[:12]}@example.com", name,
    ))["id"]


async def _booking(conn: asyncpg.Connection, *, ended_hours_ago: float, training_status: str = "scheduled", status: str = "confirmed") -> dict:
    """A confirmed booking with its session (60 minutes) that ended the given number of hours ago (negative: in the future)."""
    coach, athlete = await _user(conn, "Тренер"), await _user(conn, "Игрок")
    await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'Тренер', 'Теннис')", coach)
    starts = session_time.wall_now() - timedelta(hours=ended_hours_ago, minutes=60)  # starts_at is the platform's wall-clock time
    training = (await conn.fetchrow(
        "INSERT INTO trainings (created_by, type, training_date, start_time, duration_minutes, status) VALUES ($1, 'personal', $2, $3, 60, $4) RETURNING id",
        athlete, starts.date(), starts.time().replace(tzinfo=None), training_status,
    ))["id"]
    booking = (await conn.fetchrow(
        "INSERT INTO bookings (coach_user_id, athlete_user_id, starts_at, duration_minutes, format, currency, status, training_id) "
        "VALUES ($1, $2, $3, 60, 'offline', 'RUB', $4, $5) RETURNING id", coach, athlete, starts, status, training,
    ))["id"]
    return {"coach": coach, "athlete": athlete, "booking": booking, "training": training}


async def _refused(conn: asyncpg.Connection, sql: str, *args) -> bool:
    try:
        async with conn.transaction():
            await conn.execute(sql, *args)
    except asyncpg.CheckViolationError:
        return True
    return False


# --- the window -----------------------------------------------------------------------------------------------------------------

async def test_the_window_closes_once_and_says_how(conn) -> None:
    w = await _booking(conn, ended_hours_ago=1)
    assert await confirmations.get(conn, w["booking"]) is None  # nothing recorded yet

    first = await confirmations.confirm(conn, w["booking"], by=w["athlete"], method="athlete")
    again = await confirmations.confirm(conn, w["booking"], by=w["coach"], method="code")

    assert first is not None and (first["state"], first["confirmed_method"], first["confirmed_by"]) == ("confirmed", "athlete", w["athlete"])
    assert again is None  # closed: the second word changes nothing
    assert await confirmations.dispute(conn, w["booking"], by=w["coach"], role="coach", kind="athlete_no_show", text=None) is None


async def test_a_dispute_closes_the_road_to_confirmation_until_an_administrator_decides(conn) -> None:
    w = await _booking(conn, ended_hours_ago=1)
    admin = await _user(conn, "Админ")
    disputed = await confirmations.dispute(conn, w["booking"], by=w["coach"], role="coach", kind="athlete_no_show", text="Не пришёл")

    assert disputed is not None and disputed["state"] == "disputed"
    assert await confirmations.confirm(conn, w["booking"], by=w["athlete"], method="athlete") is None
    assert await confirmations.confirm(conn, w["booking"], by=None, method="auto") is None
    resolved = await confirmations.resolve(conn, w["booking"], by=admin, outcome="resolved_released", note="Видео с корта")
    assert resolved is not None and resolved["state"] == "resolved_released" and resolved["resolved_by"] == admin
    assert await confirmations.resolve(conn, w["booking"], by=admin, outcome="resolved_refunded", note=None) is None  # decided once


async def test_the_coachs_mark_is_only_a_mark(conn) -> None:
    w = await _booking(conn, ended_hours_ago=1)
    await confirmations.mark_by_coach(conn, w["booking"])
    first = (await confirmations.get(conn, w["booking"]))["coach_marked_at"]
    await confirmations.mark_by_coach(conn, w["booking"])

    row = await confirmations.get(conn, w["booking"])
    assert row["state"] == "awaiting" and row["confirmed_at"] is None and row["coach_marked_at"] == first


async def test_the_database_refuses_contradictions(conn) -> None:
    w = await _booking(conn, ended_hours_ago=1)
    b, athlete = w["booking"], w["athlete"]
    await confirmations.ensure(conn, b)

    assert await _refused(conn, "UPDATE session_confirmations SET state = 'confirmed' WHERE booking_id = $1", b)  # no when / how
    assert await _refused(conn, "UPDATE session_confirmations SET state = 'auto_confirmed', confirmed_at = now(), confirmed_method = 'auto', "
                                "confirmed_by = $2 WHERE booking_id = $1", b, athlete)  # automatic has no author
    assert await _refused(conn, "UPDATE session_confirmations SET state = 'confirmed', confirmed_at = now(), confirmed_method = 'auto' "
                                "WHERE booking_id = $1", b)  # 'auto' is only auto_confirmed
    assert await _refused(conn, "UPDATE session_confirmations SET state = 'confirmed', confirmed_at = now(), confirmed_method = 'athlete' "
                                "WHERE booking_id = $1", b)  # a person's confirmation names the person
    assert await _refused(conn, "UPDATE session_confirmations SET state = 'disputed', disputed_at = now() WHERE booking_id = $1", b)  # who, what
    assert await _refused(conn, "UPDATE session_confirmations SET state = 'resolved_released', disputed_at = now(), disputed_by = $2, "
                                "disputed_by_role = 'athlete', dispute_kind = 'other' WHERE booking_id = $1", b, athlete)  # resolved by whom
    await confirmations.confirm(conn, b, by=athlete, method="athlete")
    assert await _refused(conn, "UPDATE session_confirmations SET disputed_at = now() WHERE booking_id = $1", b)  # confirmed or disputed, not both


async def test_auto_confirmation_finds_only_open_windows_older_than_48_hours(conn) -> None:
    due = await _booking(conn, ended_hours_ago=49)
    recent = await _booking(conn, ended_hours_ago=47)
    closed = await _booking(conn, ended_hours_ago=60)
    disputed = await _booking(conn, ended_hours_ago=60)
    marked = await _booking(conn, ended_hours_ago=60)
    cancelled_session = await _booking(conn, ended_hours_ago=60, training_status="cancelled")
    cancelled_booking = await _booking(conn, ended_hours_ago=60, status="cancelled")
    await confirmations.confirm(conn, closed["booking"], by=closed["athlete"], method="athlete")
    await confirmations.dispute(conn, disputed["booking"], by=disputed["athlete"], role="athlete", kind="coach_no_show", text=None)
    await confirmations.mark_by_coach(conn, marked["booking"])

    found = set(await confirmations.due_for_auto_confirmation(conn, window_hours=48, limit=100))

    assert due["booking"] in found and marked["booking"] in found
    assert not found & {recent["booking"], closed["booking"], disputed["booking"], cancelled_session["booking"], cancelled_booking["booking"]}
    for booking in found:
        await confirmations.confirm(conn, booking, by=None, method="auto")
    assert set(await confirmations.due_for_auto_confirmation(conn, window_hours=48, limit=100)).isdisjoint(found)  # a second pass finds nothing


# --- the code -------------------------------------------------------------------------------------------------------------------

async def test_a_new_code_replaces_the_old_one_until_one_is_verified(conn) -> None:
    w = await _booking(conn, ended_hours_ago=-1)
    b = w["booking"]
    expires = datetime.now(timezone.utc) + timedelta(hours=3)
    one, two = code_security.generate(), code_security.generate()

    first = await codes.issue(conn, b, code_hash=code_security.digest(one, booking_id=b, secret=SECRET), expires_at=expires)
    assert first is not None and first["issued_count"] == 1
    assert await codes.count_wrong(conn, b) == 1 and await codes.count_wrong(conn, b) == 2
    second = await codes.issue(conn, b, code_hash=code_security.digest(two, booking_id=b, secret=SECRET), expires_at=expires)
    assert second is not None and second["issued_count"] == 2 and second["attempts"] == 0  # a fresh code starts its own count
    assert not code_security.matches(one, second["code_hash"], booking_id=b, secret=SECRET)
    assert code_security.matches(two, second["code_hash"], booking_id=b, secret=SECRET)

    assert await codes.mark_verified(conn, b, by=w["coach"]) is True
    assert await codes.mark_verified(conn, b, by=w["coach"]) is False
    assert await codes.issue(conn, b, code_hash=code_security.digest(one, booking_id=b, secret=SECRET), expires_at=expires) is None
    assert await codes.count_wrong(conn, b) == 0  # a verified code counts nothing any more


async def test_the_code_table_keeps_only_a_hash_and_complete_facts(conn) -> None:
    w = await _booking(conn, ended_hours_ago=-1)
    b = w["booking"]
    assert await _refused(conn, "INSERT INTO session_codes (booking_id, code_hash, expires_at) VALUES ($1, '123456', now() + interval '1 hour')", b)
    assert await _refused(conn, "INSERT INTO session_codes (booking_id, code_hash, expires_at) VALUES ($1, repeat('a', 64), now() - interval '1 hour')", b)
    await codes.issue(conn, b, code_hash="a" * 64, expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
    assert await _refused(conn, "UPDATE session_codes SET verified_at = now() WHERE booking_id = $1", b)  # verified by whom


def test_a_code_is_bound_to_its_booking_and_typed_loosely() -> None:
    code = code_security.generate()
    a, b = uuid4(), uuid4()
    assert len(code) == 6 and code.isdigit()
    assert code_security.digest(code, booking_id=a, secret=SECRET) != code_security.digest(code, booking_id=b, secret=SECRET)
    assert code_security.digest(code, booking_id=a, secret=SECRET) != code_security.digest(code, booking_id=a, secret=SECRET + "x")
    assert code_security.normalize(" 12-34 56 ") == "123456"
    assert code_security.normalize("12345") is None and code_security.normalize("12345a") is None and code_security.normalize("1234567") is None
