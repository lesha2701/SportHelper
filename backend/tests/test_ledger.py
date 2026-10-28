"""The ledger against a real PostgreSQL: balances, idempotence, immutability, overdraft protection and racing requests."""
from __future__ import annotations

import asyncio
import random
from decimal import Decimal

import asyncpg
import pytest

from app.repositories import ledger
from app.repositories.ledger import Leg, LedgerError
from app.services.money import format_rub, kopecks_to_decimal, rub_to_kopecks, split_commission, split_refund
from tests.admin_world import add_user
from tests.test_auth_postgres import _apply, pg  # noqa: F401  (fixture)


@pytest.fixture
async def db(pg):  # noqa: F811
    """The empty database with every patch applied."""
    conn = await asyncpg.connect(pg)
    try:
        await _apply(conn)
    finally:
        await conn.close()
    return pg


async def _conn(dsn):
    return await asyncpg.connect(dsn)


def _received(coach, gross=200000, fee=20000, key="payment:1:received"):
    return dict(kind="payment_received", business_key=key, legs=[
        Leg("provider_receivable", "debit", gross),
        Leg("trainer_pending", "credit", gross - fee, owner=coach),
        Leg("platform_revenue", "credit", fee),
    ])


def _uid(dsn, email):
    return add_user(dsn, email)


def run(coro):
    return asyncio.run(coro)


# --- money arithmetic --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("gross,percent,fee", [
    (200000, "10", 20000),       # 2 000 ₽ -> 200 ₽
    (99999, "10", 10000),        # 999.99 ₽ -> 99.999 -> 100.00 (half up)
    (1, "10", 0),                # 1 kopeck -> 0.1 -> 0
    (5, "10", 1),                # 0.5 kopeck -> rounds up
    (333, "15", 50),             # 49.95 -> 50
    (100000, "0", 0),
    (100000, "7.5", 7500),
])
def test_commission_is_exact_and_rounds_half_up(gross, percent, fee) -> None:
    got_fee, trainer = split_commission(gross, Decimal(percent))
    assert got_fee == fee and got_fee + trainer == gross


def test_money_conversions_never_go_through_floating_point() -> None:
    assert rub_to_kopecks(2000.0) == 200000 and rub_to_kopecks("2500.5") == 250050 and rub_to_kopecks(Decimal("0.01")) == 1
    assert rub_to_kopecks(1234.56) == 123456  # a float that is not exactly representable still converts exactly
    assert kopecks_to_decimal(123456) == Decimal("1234.56")
    assert format_rub(1080000) == "10 800,00 ₽" and format_rub(5) == "0,05 ₽"


def test_the_commission_returned_by_refunds_never_exceeds_the_commission_taken() -> None:
    gross, fee = 100003, 10000  # an awkward amount
    taken = 0
    before = 0
    for part in (33334, 33334, 33335):
        commission, trainer = split_refund(part, gross_kopecks=gross, fee_kopecks=fee, fee_already_refunded=taken, refunded_before=before, return_commission=True)
        assert commission + trainer == part
        taken += commission
        before += part
    assert taken == fee  # the last refund takes exactly the remainder
    assert split_refund(500, gross_kopecks=gross, fee_kopecks=fee, fee_already_refunded=0, refunded_before=0, return_commission=False) == (0, 500)


# --- the ledger itself ---------------------------------------------------------------------------------------------------


def test_a_posting_moves_exactly_the_balances_it_names(db) -> None:
    coach = _uid(db, "c@example.com")

    async def scenario():
        conn = await _conn(db)
        try:
            assert await ledger.post(conn, **_received(coach)) is not None
            return (await ledger.balance(conn, "provider_receivable"), await ledger.balance(conn, "platform_revenue"),
                    await ledger.trainer_balances(conn, coach))
        finally:
            await conn.close()

    receivable, revenue, trainer = run(scenario())
    assert (receivable, revenue) == (200000, 20000) and trainer["trainer_pending"] == 180000 and trainer["trainer_available"] == 0


def test_the_same_business_event_posts_once(db) -> None:
    coach = _uid(db, "c@example.com")

    async def scenario():
        conn = await _conn(db)
        try:
            first = await ledger.post(conn, **_received(coach))
            again = [await ledger.post(conn, **_received(coach)) for _ in range(3)]
            return first, again, await ledger.balance(conn, "platform_revenue"), await conn.fetchval("SELECT count(*) FROM ledger_transactions")
        finally:
            await conn.close()

    first, again, revenue, count = run(scenario())
    assert first is not None and again == [None, None, None] and revenue == 20000 and count == 1


def test_an_unbalanced_posting_is_refused_in_python_and_in_the_database(db) -> None:
    coach = _uid(db, "c@example.com")

    async def scenario():
        conn = await _conn(db)
        try:
            with pytest.raises(LedgerError):
                await ledger.post(conn, kind="x", business_key="k1", legs=[Leg("provider_receivable", "debit", 100), Leg("platform_revenue", "credit", 99)])
            # bypassing the helper: raw inserts that do not balance fail at commit
            account = await conn.fetchval("SELECT id FROM ledger_accounts WHERE code = 'platform_revenue'")
            tx = await conn.fetchval("INSERT INTO ledger_transactions (kind, business_key) VALUES ('x', 'raw') RETURNING id")
            with pytest.raises(asyncpg.IntegrityConstraintViolationError):
                async with conn.transaction():
                    await conn.execute("INSERT INTO ledger_entries (transaction_id, account_id, direction, amount_kopecks) VALUES ($1, $2, 'credit', 5)", tx, account)
            return await ledger.balance(conn, "platform_revenue")
        finally:
            await conn.close()

    assert run(scenario()) == 0  # nothing leaked into the balance


def test_the_history_cannot_be_edited_or_deleted_and_balances_cannot_be_set_directly(db) -> None:
    coach = _uid(db, "c@example.com")

    async def scenario():
        conn = await _conn(db)
        try:
            await ledger.post(conn, **_received(coach))
            statements = [
                "UPDATE ledger_entries SET amount_kopecks = 1", "DELETE FROM ledger_entries", "TRUNCATE ledger_entries",
                "UPDATE ledger_transactions SET kind = 'x'", "DELETE FROM ledger_transactions", "TRUNCATE ledger_transactions",
                "UPDATE ledger_accounts SET balance_kopecks = 999999999", "DELETE FROM ledger_accounts",
                "UPDATE ledger_accounts SET code = 'x' WHERE code = 'platform_revenue'",
            ]
            refused = []
            for statement in statements:
                try:
                    await conn.execute(statement)
                except asyncpg.PostgresError:
                    refused.append(statement)
            return refused, await ledger.balance(conn, "platform_revenue")
        finally:
            await conn.close()

    refused, revenue = run(scenario())
    assert len(refused) == 9 and revenue == 20000


def test_an_overdraft_is_impossible_and_leaves_no_trace(db) -> None:
    coach = _uid(db, "c@example.com")

    async def scenario():
        conn = await _conn(db)
        try:
            await ledger.post(conn, **_received(coach))
            await ledger.post(conn, kind="release", business_key="r1", legs=[Leg("trainer_pending", "debit", 180000, coach), Leg("trainer_available", "credit", 180000, coach)])
            with pytest.raises(asyncpg.CheckViolationError):
                await ledger.post(conn, kind="reserve", business_key="w1", legs=[Leg("trainer_available", "debit", 180001, coach), Leg("trainer_reserved", "credit", 180001, coach)])
            consumed = await conn.fetchval("SELECT count(*) FROM ledger_transactions WHERE business_key = 'w1'")
            return consumed, await ledger.trainer_balances(conn, coach)
        finally:
            await conn.close()

    consumed, balances = run(scenario())
    assert consumed == 0 and balances["trainer_available"] == 180000 and balances["trainer_reserved"] == 0  # the key is free to be retried


def test_racing_reservations_cannot_spend_the_same_money_twice(db) -> None:
    coach = _uid(db, "c@example.com")

    async def reserve(index):
        conn = await asyncpg.connect(db)
        try:
            await ledger.post(conn, kind="reserve", business_key=f"w{index}", legs=[Leg("trainer_available", "debit", 60000, coach), Leg("trainer_reserved", "credit", 60000, coach)])
            return True
        except asyncpg.CheckViolationError:
            return False
        finally:
            await conn.close()

    async def scenario():
        setup = await _conn(db)
        try:
            await ledger.post(setup, kind="x", business_key="seed", legs=[Leg("provider_receivable", "debit", 100000), Leg("trainer_available", "credit", 100000, coach)])
        finally:
            await setup.close()
        results = await asyncio.gather(*(reserve(i) for i in range(8)))
        check = await asyncpg.connect(db)
        try:
            return results, await ledger.trainer_balances(check, coach), await ledger.recompute_mismatches(check)
        finally:
            await check.close()

    results, balances, mismatches = run(scenario())
    assert sum(results) == 1 and balances["trainer_available"] == 40000 and balances["trainer_reserved"] == 60000 and mismatches == []


def test_a_random_life_of_postings_keeps_every_invariant(db) -> None:
    coaches = [_uid(db, f"c{i}@example.com") for i in range(3)]
    rng = random.Random(7)

    async def scenario():
        conn = await _conn(db)
        posted = 0
        try:
            for n in range(120):
                coach = rng.choice(coaches)
                balances = await ledger.trainer_balances(conn, coach)
                move = rng.choice(["pay", "release", "reserve", "pay_out", "unreserve"])
                try:
                    if move == "pay":
                        gross = rng.randint(100, 500000)
                        fee, trainer = split_commission(gross, Decimal("10"))
                        done = await ledger.post(conn, **_received(coach, gross, fee, key=f"pay{n}"))
                    elif move == "release" and balances["trainer_pending"]:
                        amount = rng.randint(1, balances["trainer_pending"])
                        done = await ledger.post(conn, kind="release", business_key=f"rel{n}", legs=[Leg("trainer_pending", "debit", amount, coach), Leg("trainer_available", "credit", amount, coach)])
                    elif move == "reserve" and balances["trainer_available"]:
                        amount = rng.randint(1, balances["trainer_available"])
                        done = await ledger.post(conn, kind="reserve", business_key=f"res{n}", legs=[Leg("trainer_available", "debit", amount, coach), Leg("trainer_reserved", "credit", amount, coach)])
                    elif move == "pay_out" and balances["trainer_reserved"]:
                        amount = rng.randint(1, balances["trainer_reserved"])
                        done = await ledger.post(conn, kind="payout", business_key=f"out{n}", legs=[Leg("trainer_reserved", "debit", amount, coach), Leg("payouts_external", "credit", amount)])
                    elif move == "unreserve" and balances["trainer_reserved"]:
                        amount = rng.randint(1, balances["trainer_reserved"])
                        done = await ledger.post(conn, kind="unreserve", business_key=f"unr{n}", legs=[Leg("trainer_reserved", "debit", amount, coach), Leg("trainer_available", "credit", amount, coach)])
                    else:
                        continue
                    posted += bool(done)
                except asyncpg.CheckViolationError:
                    raise AssertionError("a legitimate posting hit the overdraft guard")
            totals = await ledger.platform_totals(conn)
            debits = await conn.fetchval("SELECT COALESCE(SUM(amount_kopecks), 0) FROM ledger_entries WHERE direction = 'debit'")
            credits = await conn.fetchval("SELECT COALESCE(SUM(amount_kopecks), 0) FROM ledger_entries WHERE direction = 'credit'")
            return posted, totals, debits, credits, await ledger.recompute_mismatches(conn)
        finally:
            await conn.close()

    posted, totals, debits, credits, mismatches = run(scenario())
    assert posted > 40 and debits == credits and mismatches == []
    owed = totals["trainer_pending"] + totals["trainer_available"] + totals["trainer_reserved"]
    # the books close: what the provider holds for us = what we owe trainers + our revenue + what was already paid out
    assert totals["provider_receivable"] + totals["trainer_debt"] == owed + totals["platform_revenue"] + totals["payouts_external"]
