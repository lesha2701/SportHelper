"""The history of booking cancellations (migration 0043) against a real PostgreSQL: the table and its rules.

What is proved here is what the database itself refuses, whatever the application does: a booking is cancelled once, nothing is returned
that was not paid, an unpaid or a late cancellation returns nothing, and one refund belongs to one cancellation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.repositories import booking_cancellations as cancellations
from tests.test_auth_postgres import conn, pg  # noqa: F401  (fixtures)

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


async def _user(conn: asyncpg.Connection, name: str) -> UUID:
    return (await conn.fetchrow(
        "INSERT INTO users (email, email_verified_at, first_name, password_hash) VALUES ($1, now(), $2, 'hash') RETURNING id",
        f"user-{uuid4().hex[:12]}@example.com", name,
    ))["id"]


async def _world(conn: asyncpg.Connection, *, paid: int = 500_000) -> dict:
    """A confirmed booking with a paid payment (paid=0: no payment at all) and the ЮKassa attempt that carried it."""
    coach, athlete = await _user(conn, "Тренер"), await _user(conn, "Игрок")
    await conn.execute("INSERT INTO coach_profiles (user_id, full_name, sport) VALUES ($1, 'Тренер', 'Теннис')", coach)
    starts = datetime.now(timezone.utc) + timedelta(days=3)
    booking = (await conn.fetchrow(
        "INSERT INTO bookings (coach_user_id, athlete_user_id, starts_at, duration_minutes, format, currency, status) "
        "VALUES ($1, $2, $3, 60, 'online', 'RUB', 'confirmed') RETURNING id", coach, athlete, starts,
    ))["id"]
    world = {"coach": coach, "athlete": athlete, "booking": booking, "starts": starts, "payment": None, "attempt": None}
    if paid:
        fee = paid // 10
        payment = (await conn.fetchrow(
            "INSERT INTO payments (booking_id, payer_user_id, coach_user_id, currency, gross_kopecks, commission_percent, platform_fee_kopecks, "
            "trainer_kopecks, status, paid_at) VALUES ($1, $2, $3, 'RUB', $4, 10, $5, $6, 'paid', now()) RETURNING id",
            booking, athlete, coach, paid, fee, paid - fee,
        ))["id"]
        attempt = (await conn.fetchrow(
            "INSERT INTO payment_attempts (payment_id, provider_payment_id, status, paid_at) VALUES ($1, $2, 'succeeded', now()) RETURNING id",
            payment, f"pay-{uuid4().hex}",
        ))["id"]
        world.update(payment=payment, attempt=attempt)
    return world


async def _refund(conn: asyncpg.Connection, world: dict, amount: int, requested_by: UUID) -> UUID:
    fee = amount // 10
    await conn.execute("UPDATE payments SET refund_reserved_kopecks = refund_reserved_kopecks + $2 WHERE id = $1", world["payment"], amount)
    return (await conn.fetchrow(
        "INSERT INTO refunds (payment_id, attempt_id, kind, amount_kopecks, commission_refund_kopecks, trainer_refund_kopecks, reason, requested_by) "
        "VALUES ($1, $2, 'payment', $3, $4, $5, 'Отмена записи', $6) RETURNING id",
        world["payment"], world["attempt"], amount, fee, amount - fee, requested_by,
    ))["id"]


async def _cancel(conn: asyncpg.Connection, world: dict, *, by: str = "athlete", policy: str = "athlete_early", paid: int = 500_000,
                  percent: int = 100, refund: int | None = None, reason: str | None = None) -> dict | None:
    return await cancellations.insert(
        conn, booking_id=world["booking"], cancelled_by=world["athlete"] if by == "athlete" else world["coach"], cancelled_by_role=by,
        reason=reason, session_starts_at=world["starts"], hours_before_start=Decimal("72.00"), policy=policy,
        paid_kopecks=paid, refund_percent=percent, refund_kopecks=paid * percent // 100 if refund is None else refund,
    )


async def test_the_table_exists_in_a_fresh_database(conn) -> None:  # noqa: F811
    assert await conn.fetchval("SELECT to_regclass('booking_cancellations')") is not None


async def test_a_cancellation_is_recorded_and_read_back(conn) -> None:  # noqa: F811
    world = await _world(conn)
    row = await _cancel(conn, world, reason="Заболел")
    assert row is not None
    assert (row["cancelled_by_role"], row["policy"], row["refund_percent"], row["refund_kopecks"], row["paid_kopecks"]) == ("athlete", "athlete_early", 100, 500_000, 500_000)
    assert row["hours_before_start"] == Decimal("72.00") and row["reason"] == "Заболел" and row["refund_id"] is None
    assert (await cancellations.get_for_booking(conn, world["booking"]))["id"] == row["id"]
    assert await cancellations.get_for_booking(conn, uuid4()) is None


async def test_a_booking_is_cancelled_only_once(conn) -> None:  # noqa: F811
    world = await _world(conn)
    assert await _cancel(conn, world) is not None
    assert await _cancel(conn, world, by="coach", policy="coach") is None, "the second cancellation must be refused, not overwrite the first"
    assert await conn.fetchval("SELECT count(*) FROM booking_cancellations WHERE booking_id = $1", world["booking"]) == 1
    assert (await cancellations.get_for_booking(conn, world["booking"]))["cancelled_by_role"] == "athlete"


async def test_an_unpaid_cancellation_returns_nothing(conn) -> None:  # noqa: F811
    world = await _world(conn, paid=0)
    row = await _cancel(conn, world, policy="unpaid", paid=0, percent=0, refund=0)
    assert row is not None and row["refund_kopecks"] == 0
    other = await _world(conn, paid=0)
    with pytest.raises(asyncpg.CheckViolationError):  # «unpaid» cannot claim that anything was paid or returned
        await _cancel(conn, other, policy="unpaid", paid=100_000, percent=100)


async def test_a_late_cancellation_by_the_athlete_returns_nothing(conn) -> None:  # noqa: F811
    world = await _world(conn)
    row = await _cancel(conn, world, policy="athlete_late", percent=0, refund=0)
    assert row is not None and row["refund_percent"] == 0
    other = await _world(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await _cancel(conn, other, policy="athlete_late", percent=100)


async def test_nothing_is_returned_that_was_not_paid(conn) -> None:  # noqa: F811
    world = await _world(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await _cancel(conn, world, paid=500_000, percent=100, refund=500_001)


async def test_the_percent_and_the_amount_agree_about_nothing(conn) -> None:  # noqa: F811
    for percent, refund in ((50, 0), (0, 1)):
        world = await _world(conn)
        with pytest.raises(asyncpg.CheckViolationError):
            await _cancel(conn, world, policy="coach", by="coach", percent=percent, refund=refund)


async def test_the_role_the_policy_and_the_percent_have_to_be_known(conn) -> None:  # noqa: F811
    world = await _world(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await _cancel(conn, world, by="athlete", policy="friendly")
    other = await _world(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await cancellations.insert(conn, booking_id=other["booking"], cancelled_by=other["athlete"], cancelled_by_role="admin", reason=None,
                                   session_starts_at=other["starts"], hours_before_start=Decimal("5"), policy="coach", paid_kopecks=0,
                                   refund_percent=0, refund_kopecks=0)
    third = await _world(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await _cancel(conn, third, percent=101, refund=500_000)


async def test_the_refund_is_attached_once_and_only_when_there_is_money_to_return(conn) -> None:  # noqa: F811
    world = await _world(conn)
    await _cancel(conn, world, by="coach", policy="coach")
    refund = await _refund(conn, world, 500_000, world["coach"])
    assert await cancellations.attach_refund(conn, world["booking"], refund) is True
    assert (await cancellations.get_for_booking(conn, world["booking"]))["refund_id"] == refund
    other = await _world(conn)
    assert await cancellations.attach_refund(conn, world["booking"], await _refund(conn, other, 100, other["coach"])) is False, "a cancellation has one refund"

    nothing = await _world(conn)
    await _cancel(conn, nothing, policy="athlete_late", percent=0, refund=0)
    assert await cancellations.attach_refund(conn, nothing["booking"], refund) is False, "nothing to return, so nothing to attach"


async def test_one_refund_cannot_belong_to_two_cancellations(conn) -> None:  # noqa: F811
    first = await _world(conn)
    await _cancel(conn, first, by="coach", policy="coach")
    refund = await _refund(conn, first, 500_000, first["coach"])
    assert await cancellations.attach_refund(conn, first["booking"], refund) is True
    second = await _world(conn)
    await _cancel(conn, second, by="coach", policy="coach")
    with pytest.raises(asyncpg.UniqueViolationError):
        await cancellations.attach_refund(conn, second["booking"], refund)


async def test_the_patch_is_safe_to_run_twice(conn) -> None:  # noqa: F811
    from app.config import DATABASE_DIR

    await conn.execute((DATABASE_DIR / "patches" / "0043_booking_cancellations.sql").read_text(encoding="utf-8"))
    assert await conn.fetchval("SELECT to_regclass('booking_cancellations')") is not None
