"""Earnings, the trainer's balance, withdrawals, refunds and the finance administration - against a real PostgreSQL."""
from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace

import asyncpg
import pytest

from app.config import get_settings
from app.repositories import ledger
from app.repositories.ledger import Leg
from app.services import earnings as earnings_service
from tests.admin_world import ADMIN_EMAIL, live_client, pg, set_admins, world  # noqa: F401  (fixtures)
from tests.finance_helpers import (
    FakeProvider, assert_books_are_sound, confirmed_booking, enable_payments, ledger_totals, run, trainer_balances, webhook, with_conn,
)
from tests.live_helpers import AdminBrowser, Browser, sql, sql_value

PASSWORD = "correct horse battery"
SBP = {"phone": "+7 912 345-67-89", "bank": "Сбербанк", "recipient": "Иванов Иван Иванович"}


@pytest.fixture
def fin(world, monkeypatch):  # noqa: F811
    provider = FakeProvider()
    enable_payments(monkeypatch, provider, TRAINER_BALANCE_ENABLED="true", TRAINER_WITHDRAWALS_ENABLED="true",
                    TRAINER_PAYOUT_CONFIRMATION_ENABLED="true", FINANCE_ADMIN_EMAILS=ADMIN_EMAIL, TRAINER_MIN_WITHDRAWAL_RUB="1000")
    return SimpleNamespace(world=world, provider=provider, dsn=world.dsn, admin=world.admin, monkeypatch=monkeypatch)


def reconfigure(fin, **env: str) -> None:
    for key, value in env.items():
        fin.monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def paid_booking(fin, n: int = 0):
    """A booking that has been confirmed, paid for and booked: (coach, player, booking, payment id)."""
    coach, player, booking = confirmed_booking(fin.world, coach_email=f"coach{n}@example.com", player_email=f"player{n}@example.com", title=f"Спорт {n}", confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(p for p in fin.provider.payments if fin.provider.payments[p]["metadata"]["booking_id"] == booking["id"])
    fin.provider.finish(pid, "succeeded")
    assert webhook(fin.world, pid).status_code == 200
    payment_id = sql_value(fin.dsn, "SELECT id::text FROM payments WHERE booking_id = $1::uuid", booking["id"])
    return coach, player, booking, payment_id


def conduct(fin, coach, booking) -> None:
    sql(fin.dsn, "UPDATE bookings SET starts_at = now() - interval '2 hours' WHERE id = $1::uuid", booking["id"])
    coach.ok("POST", f"/api/bookings/{booking['id']}/complete")


def earning_of(fin, booking) -> str:
    return sql_value(fin.dsn, "SELECT id::text FROM trainer_earnings WHERE booking_id = $1::uuid", booking["id"])


def available_money(fin, coach_id: str, kopecks: int, key: str | None = None) -> None:
    """Puts money straight into a trainer's available balance (to test thresholds without paying many bookings)."""
    async def go(conn):
        await ledger.post(conn, kind="test_credit", business_key=key or f"test:{uuid.uuid4()}",
                          legs=[Leg("provider_receivable", "debit", kopecks), Leg("trainer_available", "credit", kopecks, uuid.UUID(coach_id))])

    run(with_conn(fin.dsn, go))


def ask_withdrawal(coach, amount: int, *, key: str | None = None, password: str = PASSWORD, method: str = "sbp", details: dict | None = None):
    return coach.call("POST", "/api/finance/withdrawals", json={
        "amount_kopecks": amount, "method": method, "details": details or SBP, "client_key": key or str(uuid.uuid4()), "password": password})


def unlocked_admin(fin) -> AdminBrowser:
    return fin.admin


# --- earnings: pending -> available ------------------------------------------------------------------------------------------


def test_a_payment_alone_never_makes_money_withdrawable(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    balance = coach.ok("GET", "/api/finance/summary")

    assert (balance["pending_kopecks"], balance["available_kopecks"], balance["reserved_kopecks"]) == (225000, 0, 0)
    assert coach.call("POST", "/api/finance/withdrawals", json={"amount_kopecks": 225000, "method": "sbp", "details": SBP,
                                                                  "client_key": str(uuid.uuid4()), "password": PASSWORD}).status_code == 409
    # nor does the session time passing: the trainer has to mark it conducted, and an administrator releases it
    sql(fin.dsn, "UPDATE bookings SET starts_at = now() - interval '5 days' WHERE id = $1::uuid", booking["id"])
    assert fin.admin.call("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release", json={}).json()["error"]["code"] == "session_not_confirmed"
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 0


def test_the_full_release_path_with_notifications_and_an_audit_trail(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    earning_id = earning_of(fin, booking)
    assert sql_value(fin.dsn, "SELECT session_confirmed_at IS NOT NULL FROM trainer_earnings") is True
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 0  # marked conducted is only the START of the check

    released = fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_id}/release", json={"note": "проверено"})

    assert released["status"] == "available"
    summary = coach.ok("GET", "/api/finance/summary")
    assert (summary["available_kopecks"], summary["pending_kopecks"]) == (225000, 0)
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE category = 'earning_update' AND title = 'Начисление доступно к выводу'") == 1
    # the money notifications are real list items for the person (the list's schema knows their categories)
    listed = coach.ok("GET", "/api/notifications")
    assert "earning_update" in {n["category"] for n in listed}
    assert "earning_update" not in {p["category"] for p in coach.ok("GET", "/api/notifications/preferences")}
    audit = sql(fin.dsn, "SELECT action, result FROM admin_audit_log WHERE action = 'finance.earning.release'")
    assert [(a["action"], a["result"]) for a in audit] == [("finance.earning.release", "success")]
    # releasing again changes nothing (idempotent) and posts nothing twice
    again = fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_id}/release", json={})
    assert again["status"] == "available" and sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'earning_released'") == 1
    assert_books_are_sound(fin.dsn)


def test_a_frozen_earning_cannot_be_released_until_the_hold_is_lifted(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    earning_id = earning_of(fin, booking)

    assert fin.admin.call("POST", f"/api/admin/finance/earnings/{earning_id}/hold", json={"reason": "спор с игроком"}).status_code == 200
    blocked = fin.admin.call("POST", f"/api/admin/finance/earnings/{earning_id}/release", json={})
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "earning_held"
    assert fin.admin.call("POST", f"/api/admin/finance/earnings/{earning_id}/unhold", json={"reason": "спор закрыт"}).status_code == 200
    assert fin.admin.call("POST", f"/api/admin/finance/earnings/{earning_id}/release", json={}).status_code == 200


def test_release_is_for_finance_administrators_with_a_recent_second_factor(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    url = f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release"

    assert coach.call("POST", url, json={}).status_code == 403            # the trainer cannot release his own money
    assert player.call("POST", url, json={}).status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS="somebody.else@example.com")      # an administrator who is not a finance administrator
    refused = fin.admin.call("POST", url, json={})
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "finance_access_required"
    assert fin.admin.call("GET", "/api/admin/finance/overview").status_code == 403
    reconfigure(fin, FINANCE_ADMIN_EMAILS=ADMIN_EMAIL)
    fin.admin.fresh_session()                                               # a new session that has not passed the second factor
    assert fin.admin.call("POST", url, json={}).json()["error"]["code"] == "mfa_required"
    assert sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "pending"


def test_the_automatic_release_mode_waits_for_the_hold_period(fin) -> None:
    reconfigure(fin, EARNING_RELEASE_MODE="auto_after_hold", EARNING_HOLD_HOURS="72")
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    settings = get_settings()

    assert run(with_conn(fin.dsn, lambda c: earnings_service.release_due_earnings(c, settings))) == 0
    sql(fin.dsn, "UPDATE trainer_earnings SET session_confirmed_at = now() - interval '73 hours'")
    assert run(with_conn(fin.dsn, lambda c: earnings_service.release_due_earnings(c, settings))) == 1
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 225000
    # a frozen earning is never released automatically
    coach2, player2, booking2, _ = paid_booking(fin, 2)
    conduct(fin, coach2, booking2)
    fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking2)}/hold", json={"reason": "проверка"})
    sql(fin.dsn, "UPDATE trainer_earnings SET session_confirmed_at = now() - interval '200 hours' WHERE status = 'held'")
    assert run(with_conn(fin.dsn, lambda c: earnings_service.release_due_earnings(c, settings))) == 0


def test_the_default_mode_never_releases_by_itself(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    sql(fin.dsn, "UPDATE trainer_earnings SET session_confirmed_at = now() - interval '999 hours'")

    assert run(with_conn(fin.dsn, lambda c: earnings_service.release_due_earnings(c, get_settings()))) == 0
    assert sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "pending"


# --- the trainer's screens ---------------------------------------------------------------------------------------------------


def again(fin, email: str) -> Browser:
    """Signs a person who registered earlier in the scenario back in."""
    browser = Browser.__new__(Browser)
    browser.client, browser.email, browser.cookies, browser.csrf, browser.password = fin.world.client, email, {}, "", PASSWORD
    return browser.login()


def test_the_balance_history_shows_the_commission_and_is_paginated(fin) -> None:
    for n in range(3):
        paid_booking(fin, n)
    coach0 = again(fin, "coach0@example.com")

    page = coach0.ok("GET", "/api/finance/operations", params={"limit": 1})

    assert page["total"] == 1 and page["limit"] == 1  # coach 0 has exactly one booking
    item = page["items"][0]
    assert (item["kind"], item["amount_kopecks"], item["gross_kopecks"], item["platform_fee_kopecks"], item["trainer_kopecks"]) == ("payment_received", 225000, 250000, 25000, 225000)
    assert item["listing_title"] == "Спорт 0" and item["earning_status"] == "pending"
    assert coach0.call("GET", "/api/finance/operations", params={"limit": 0}).status_code == 422
    assert coach0.call("GET", "/api/finance/operations", params={"limit": 1000}).status_code == 422


def test_the_history_pages_through_many_operations(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    for n in range(5):
        available_money(fin, coach.user_id, 10_000 + n)

    first = coach.ok("GET", "/api/finance/operations", params={"limit": 3})
    second = coach.ok("GET", "/api/finance/operations", params={"limit": 3, "offset": 3})

    assert first["total"] == 6 and len(first["items"]) == 3 and len(second["items"]) == 3
    assert {i["id"] for i in first["items"]}.isdisjoint({i["id"] for i in second["items"]})


def test_a_trainer_sees_only_his_own_money(fin) -> None:
    coach1, _, b1, _ = paid_booking(fin, 1)
    coach2 = Browser(fin.world.client, "other@example.com", "Другой", "coach")
    coach2.ok("PUT", "/api/profile/coach", json={"full_name": "Другой тренер", "sport": "Теннис", "experience_years": 1, "specialization": None, "description": None})

    assert coach2.ok("GET", "/api/finance/summary")["pending_kopecks"] == 0
    assert coach2.ok("GET", "/api/finance/operations")["total"] == 0
    assert coach1.ok("GET", "/api/finance/summary")["pending_kopecks"] == 225000


def test_the_finance_screens_are_closed_to_guests_players_and_while_switched_off(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    world = fin.world
    world.client.cookies.clear()
    for path in ("/api/finance/summary", "/api/finance/operations", "/api/finance/withdrawals"):
        assert world.client.get(path).status_code == 401
    for path in ("/api/finance/summary", "/api/finance/operations", "/api/finance/withdrawals"):
        assert player.call("GET", path).status_code == 403  # a player has no coach profile
    reconfigure(fin, TRAINER_BALANCE_ENABLED="false")
    assert coach.call("GET", "/api/finance/summary").status_code == 503


def test_there_is_no_way_to_add_money_through_the_api(fin) -> None:
    from app.main import app

    finance_routes = sorted((m, r.path) for r in app.routes if getattr(r, "path", "").startswith("/api/finance") for m in r.methods if m not in ("HEAD", "OPTIONS"))
    assert finance_routes == [("GET", "/api/finance/operations"), ("GET", "/api/finance/summary"), ("GET", "/api/finance/withdrawals"),
                              ("POST", "/api/finance/withdrawals"), ("POST", "/api/finance/withdrawals/{withdrawal_id}/cancel")]
    admin_money = [(m, r.path) for r in app.routes if getattr(r, "path", "").startswith("/api/admin/finance") for m in r.methods if m in ("PUT", "PATCH", "DELETE")]
    assert admin_money == []  # nothing edits or removes financial records
    coach, player, booking, _ = paid_booking(fin)
    for body in ({"available_kopecks": 99999999}, {"amount_kopecks": 100000}, {"commission_percent": 0}):
        for method in ("POST", "PUT", "PATCH"):
            assert coach.call(method, "/api/finance/summary", json=body).status_code in (404, 405)
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 0


# --- withdrawals -------------------------------------------------------------------------------------------------------------


def test_the_minimum_applies_to_the_available_balance_at_the_exact_boundary(fin) -> None:
    reconfigure(fin, TRAINER_MIN_WITHDRAWAL_RUB="10000")
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 999999)                      # 9 999,99 ₽

    summary = coach.ok("GET", "/api/finance/summary")
    assert (summary["can_withdraw"], summary["shortfall_kopecks"], summary["minimum_withdrawal_kopecks"]) == (False, 1, 1000000)
    refused = ask_withdrawal(coach, 999999)
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "below_minimum"
    assert ask_withdrawal(coach, 1000000).status_code == 409         # not enough available yet

    available_money(fin, coach.user_id, 1)                           # exactly 10 000,00 ₽
    summary = coach.ok("GET", "/api/finance/summary")
    assert (summary["can_withdraw"], summary["shortfall_kopecks"]) == (True, 0)
    assert ask_withdrawal(coach, 1000000).status_code == 201
    assert coach.ok("GET", "/api/finance/summary")["available_kopecks"] == 0


def test_part_of_the_balance_or_all_of_it(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 5_000_00)

    part = ask_withdrawal(coach, 200_000)
    rest = ask_withdrawal(coach, 300_000)

    assert part.status_code == rest.status_code == 201
    summary = coach.ok("GET", "/api/finance/summary")
    assert (summary["available_kopecks"], summary["reserved_kopecks"]) == (0, 500_000)
    assert ask_withdrawal(coach, 100_000).status_code == 409  # nothing left to reserve
    assert_books_are_sound(fin.dsn)


def test_a_request_reserves_money_and_cannot_overdraw(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 150_000)

    over = ask_withdrawal(coach, 150_001)

    assert over.status_code == 409 and over.json()["error"]["code"] == "insufficient_balance"
    assert sql_value(fin.dsn, "SELECT count(*) FROM withdrawal_requests") == 0 and trainer_balances(fin.dsn, coach.user_id)["trainer_available"] == 150_000


def test_the_same_form_sent_twice_creates_one_request(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    key = str(uuid.uuid4())

    first = ask_withdrawal(coach, 150_000, key=key)
    second = ask_withdrawal(coach, 150_000, key=key)

    assert (first.status_code, second.status_code) == (201, 200) and first.json()["id"] == second.json()["id"]
    assert sql_value(fin.dsn, "SELECT count(*) FROM withdrawal_requests") == 1 and trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 150_000


def test_parallel_requests_cannot_reserve_the_same_money(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 1_000_000)
    settings = get_settings()
    user = {"id": uuid.UUID(coach.user_id), "first_name": "Т", "last_name": None, "email": "coach0@example.com"}

    async def attempt(index):
        from app.services import withdrawals as withdrawals_service

        conn = await asyncpg.connect(fin.dsn)
        try:
            await withdrawals_service.create_withdrawal(conn, settings, user=user, amount_kopecks=600_000, method="sbp", raw_details=SBP,
                                                        client_key=uuid.uuid4(), password=PASSWORD)
            return "ok"
        except Exception as exc:  # noqa: BLE001
            return getattr(exc, "code", type(exc).__name__)
        finally:
            await conn.close()

    async def together():
        return await asyncio.gather(*(attempt(i) for i in range(8)))

    results = run(together())

    assert results.count("ok") == 1 and set(results) - {"ok"} == {"insufficient_balance"}
    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_available"], balances["trainer_reserved"]) == (400_000, 600_000)
    assert sql_value(fin.dsn, "SELECT count(*) FROM withdrawal_requests") == 1
    assert_books_are_sound(fin.dsn)


def test_a_request_needs_the_account_password_and_valid_non_card_details(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)

    assert ask_withdrawal(coach, 150_000, password="wrong password here").json()["error"]["code"] == "invalid_password"
    for bad in ({"phone": "123", "bank": "Сбербанк", "recipient": "Иванов Иван"},
                {"phone": "+7 912 345-67-89", "bank": "Сбербанк", "recipient": "4276 3800 1234 5674"},        # a card number (Luhn-valid)
                {"phone": "+7 912 345-67-89", "bank": "4111111111111111", "recipient": "Иванов Иван"},
                {"phone": "+7 912 345-67-89", "bank": "Сбербанк", "recipient": "Иванов Иван", "card": "4111111111111111"},
                {"phone": "+7 912 345-67-89", "bank": "Сбербанк", "recipient": "Иванов Иван", "cvv": "123"},
                {"phone": "+7 912 345-67-89", "bank": "<b>Сбер</b>", "recipient": "Иванов Иван"}):
        assert ask_withdrawal(coach, 150_000, details=bad).status_code == 422, bad
    assert ask_withdrawal(coach, 150_000, method="card").status_code == 422
    assert sql_value(fin.dsn, "SELECT count(*) FROM withdrawal_requests") == 0


def test_payout_details_are_encrypted_masked_and_fixed_per_request(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)

    created = ask_withdrawal(coach, 150_000).json()

    assert created["details_hint"] == "СБП · +7 ••• •••-••-89 · Сбербанк" and "details" not in created and "details_enc" not in created
    stored = sql_value(fin.dsn, "SELECT details_enc FROM withdrawal_requests")
    assert "912" not in stored and "Иванов" not in stored and "Сбербанк" not in stored  # nothing readable at rest
    listed = coach.ok("GET", "/api/finance/withdrawals")["items"][0]
    assert "912" not in json.dumps(listed) and listed["details_hint"] == created["details_hint"]
    detail = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{created['id']}/details")
    assert detail["details"]["phone"] == "+79123456789" and detail["details"]["recipient"] == "Иванов Иван Иванович"
    audit = sql(fin.dsn, "SELECT action FROM admin_audit_log WHERE action = 'finance.withdrawal.details_viewed'")
    assert len(audit) == 1  # looking at the requisites is itself recorded
    assert coach.call("POST", f"/api/admin/finance/withdrawals/{created['id']}/details").status_code == 403
    # there is no way to change the requisites of an existing request
    from app.main import app

    assert not [r.path for r in app.routes if "withdrawal" in getattr(r, "path", "") and r.methods & {"PUT", "PATCH"}]


def test_a_trainer_can_cancel_until_it_goes_to_payment(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]

    canceled = coach.ok("POST", f"/api/finance/withdrawals/{wid}/cancel")

    assert canceled["status"] == "canceled"
    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_available"], balances["trainer_reserved"]) == (400_000, 0)
    assert coach.ok("POST", f"/api/finance/withdrawals/{wid}/cancel")["status"] == "canceled"  # repeating is harmless
    assert sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'withdrawal_released'") == 1
    wid2 = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid2}/{step}", json={})
    late = coach.call("POST", f"/api/finance/withdrawals/{wid2}/cancel")
    assert late.status_code == 409 and late.json()["error"]["code"] == "withdrawal_not_cancelable"


def test_nobody_can_act_on_another_trainers_request(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    other = Browser(fin.world.client, "other@example.com", "Другой", "coach")
    other.ok("PUT", "/api/profile/coach", json={"full_name": "Другой", "sport": "Теннис", "experience_years": 1, "specialization": None, "description": None})

    assert other.call("POST", f"/api/finance/withdrawals/{wid}/cancel").status_code == 404
    assert other.ok("GET", "/api/finance/withdrawals")["total"] == 0
    assert other.call("POST", f"/api/admin/finance/withdrawals/{wid}/approve", json={}).status_code == 403
    assert sql_value(fin.dsn, "SELECT status FROM withdrawal_requests") == "requested"


def test_the_manual_payout_process_end_to_end(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE category = 'finance_admin'") == 1  # the administrator is told (no requisites in it)
    note = sql_value(fin.dsn, "SELECT body FROM notifications WHERE category = 'finance_admin'")
    assert "912" not in note and "Сбербанк" not in note

    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/review", json={})
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/approve", json={})
    fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/processing", json={})
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 150_000  # still reserved while the transfer is being made
    paid = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "PP-2026-000123", "paid_amount_kopecks": 150_000, "transfer_note": "СБП"})

    assert paid["status"] == "paid" and paid["bank_reference"] == "PP-2026-000123"
    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_reserved"], balances["trainer_available"]) == (0, 250_000)
    assert ledger_totals(fin.dsn)["payouts_external"] == 150_000
    assert coach.ok("GET", "/api/finance/summary")["paid_out_kopecks"] == 150_000
    events = [(e["from_status"], e["to_status"]) for e in sql(fin.dsn, "SELECT from_status, to_status FROM withdrawal_events ORDER BY id")]
    assert events == [(None, "requested"), ("requested", "under_review"), ("under_review", "approved"), ("approved", "processing"), ("processing", "paid")]
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE category = 'withdrawal_update' AND title = 'Выплата проведена'") == 1
    actions = [a["action"] for a in sql(fin.dsn, "SELECT action FROM admin_audit_log WHERE action LIKE 'finance.withdrawal.%' ORDER BY created_at")]
    assert actions == ["finance.withdrawal.review", "finance.withdrawal.approve", "finance.withdrawal.start_processing", "finance.withdrawal.mark_paid"]
    assert_books_are_sound(fin.dsn)


def test_confirming_the_same_payout_twice_pays_once(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})
    body = {"bank_reference": "PP-777777", "paid_amount_kopecks": 150_000}

    first = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json=body)
    second = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json=body)

    assert first["status"] == second["status"] == "paid"
    assert sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'withdrawal_paid'") == 1 and ledger_totals(fin.dsn)["payouts_external"] == 150_000


def test_two_administrators_cannot_both_confirm_one_payout(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})
    settings = get_settings()
    from app.services import withdrawals as withdrawals_service

    async def confirm(n):
        conn = await asyncpg.connect(fin.dsn)
        try:
            admin = {"id": uuid.UUID(fin.admin.user_id)}
            await withdrawals_service.admin_step(conn, settings, admin=admin, withdrawal_id=uuid.UUID(wid), action="mark_paid",
                                                 bank_reference=f"PP-{n:06d}", paid_amount_kopecks=150_000)
            return "ok"
        except Exception as exc:  # noqa: BLE001
            return getattr(exc, "code", type(exc).__name__)
        finally:
            await conn.close()

    async def together():
        return await asyncio.gather(*(confirm(n) for n in range(6)))

    results = run(together())

    assert sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'withdrawal_paid'") == 1
    assert ledger_totals(fin.dsn)["payouts_external"] == 150_000 and sql_value(fin.dsn, "SELECT status FROM withdrawal_requests") == "paid"
    assert results.count("ok") >= 1 and set(results) <= {"ok", "withdrawal_changed"}
    assert_books_are_sound(fin.dsn)


def test_a_bank_operation_confirms_only_one_payout(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 800_000)
    ids = [ask_withdrawal(coach, 150_000).json()["id"] for _ in range(2)]
    for wid in ids:
        for step in ("review", "approve", "processing"):
            fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})
    body = {"bank_reference": "SAME-OPERATION-1", "paid_amount_kopecks": 150_000}

    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{ids[0]}/paid", json=body).status_code == 200
    reuse = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{ids[1]}/paid", json=body)

    assert reuse.status_code == 409 and reuse.json()["error"]["code"] == "bank_reference_used"
    assert sql_value(fin.dsn, "SELECT status FROM withdrawal_requests WHERE id = $1::uuid", ids[1]) == "processing"


def test_a_payout_needs_the_exact_amount_a_reference_and_the_switch_on(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})

    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "PP-111111", "paid_amount_kopecks": 149_999}).json()["error"]["code"] == "amount_mismatch"
    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "ab", "paid_amount_kopecks": 150_000}).status_code == 422
    reconfigure(fin, TRAINER_PAYOUT_CONFIRMATION_ENABLED="false")
    off = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "PP-111111", "paid_amount_kopecks": 150_000})
    assert off.status_code == 409 and off.json()["error"]["code"] == "payout_confirmation_disabled"
    assert sql_value(fin.dsn, "SELECT count(*) FROM admin_audit_log WHERE action = 'finance.withdrawal.mark_paid' AND result = 'denied'") == 1
    assert sql_value(fin.dsn, "SELECT status FROM withdrawal_requests") == "processing" and ledger_totals(fin.dsn)["payouts_external"] == 0


def test_the_status_machine_refuses_every_shortcut(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]

    for step in ("approve", "processing", "paid"):  # cannot skip the review
        body = {"bank_reference": "PP-222222", "paid_amount_kopecks": 150_000} if step == "paid" else {}
        refused = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json=body)
        assert refused.status_code == 409 and refused.json()["error"]["code"] == "invalid_transition", step
    assert sql_value(fin.dsn, "SELECT status FROM withdrawal_requests") == "requested"
    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/explode", json={}).status_code in (404, 405)


def test_rejecting_releases_the_reservation_but_a_transfer_in_progress_needs_an_explicit_statement(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 800_000)
    first = ask_withdrawal(coach, 150_000).json()["id"]
    second = ask_withdrawal(coach, 150_000).json()["id"]

    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{first}/reject", json={}).status_code == 422  # a reason is required
    rejected = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{first}/reject", json={"reason": "реквизиты не прошли проверку"})
    assert rejected["status"] == "rejected" and trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 150_000
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Заявка на вывод отклонена' AND body LIKE '%реквизиты не прошли проверку%'") == 1

    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{second}/{step}", json={})
    unclear = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{second}/reject", json={"reason": "сбой банка"})
    assert unclear.status_code == 409 and unclear.json()["error"]["code"] == "confirm_not_sent_required"
    assert trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 150_000  # the money stays reserved: nothing is returned blindly
    sure = fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{second}/reject", json={"reason": "сбой банка", "confirm_not_sent": True})
    assert sure["status"] == "rejected" and trainer_balances(fin.dsn, coach.user_id)["trainer_reserved"] == 0
    assert fin.admin.call("POST", f"/api/admin/finance/withdrawals/{second}/review", json={}).status_code == 409  # final states stay final


def test_the_two_person_rule_when_it_is_switched_on(fin) -> None:
    reconfigure(fin, FINANCE_TWO_PERSON_RULE="true")
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    wid = ask_withdrawal(coach, 150_000).json()["id"]
    for step in ("review", "approve", "processing"):
        fin.admin.ok("POST", f"/api/admin/finance/withdrawals/{wid}/{step}", json={})

    same_person = fin.admin.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "PP-333333", "paid_amount_kopecks": 150_000})

    assert same_person.status_code == 403 and same_person.json()["error"]["code"] == "two_person_rule"
    reconfigure(fin, ADMIN_EMAILS=f"{ADMIN_EMAIL},second@example.com", FINANCE_ADMIN_EMAILS=f"{ADMIN_EMAIL},second@example.com")
    second = AdminBrowser(fin.world.client, "second@example.com", "Второй", role=None).enable_mfa()
    ok = second.call("POST", f"/api/admin/finance/withdrawals/{wid}/paid", json={"bank_reference": "PP-333333", "paid_amount_kopecks": 150_000})
    assert ok.status_code == 200 and ok.json()["paid_by"] == second.user_id


def test_the_withdrawal_switch_blocks_new_requests(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    reconfigure(fin, TRAINER_WITHDRAWALS_ENABLED="false")

    response = ask_withdrawal(coach, 150_000)

    assert response.status_code == 503 and response.json()["error"]["code"] == "withdrawals_unavailable"
    assert coach.ok("GET", "/api/finance/summary")["can_withdraw"] is False


def test_requests_are_rate_limited(fin) -> None:
    reconfigure(fin, AUTH_RATE_LIMIT_ENABLED="true", WITHDRAWAL_REQUESTS_PER_HOUR="2")
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 800_000)

    statuses = [ask_withdrawal(coach, 100_000).status_code for _ in range(3)]

    assert statuses == [201, 201, 429]


# --- refunds -----------------------------------------------------------------------------------------------------------------


def _refund(fin, payment_id: str, amount: int, reason: str = "тренер не пришёл", **extra):
    return fin.admin.call("POST", f"/api/admin/finance/payments/{payment_id}/refund", json={"amount_kopecks": amount, "reason": reason, **extra})


def _finish_refund(fin, status: str = "succeeded") -> str:
    rid = next(iter(fin.provider.refunds))
    fin.provider.finish_refund(rid, status)
    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200
    return rid


def test_a_full_refund_before_release_reverses_everything(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)

    requested = _refund(fin, payment_id, 250000)
    assert requested.status_code == 200 and requested.json()["status"] == "pending"
    assert ledger_totals(fin.dsn)["platform_revenue"] == 25000  # nothing is booked until the provider confirms it
    _finish_refund(fin)

    assert sql_value(fin.dsn, "SELECT status FROM payments") == "refunded" and sql_value(fin.dsn, "SELECT status FROM trainer_earnings") == "reversed"
    totals = ledger_totals(fin.dsn)
    assert (totals["provider_receivable"], totals["platform_revenue"], totals["trainer_pending"], totals["trainer_debt"]) == (0, 0, 0, 0)
    assert player.ok("GET", "/api/bookings/me")[0]["payment_status"] == "refunded"
    assert sql_value(fin.dsn, "SELECT count(*) FROM notifications WHERE title = 'Возврат выполнен'") == 1
    assert_books_are_sound(fin.dsn)


def test_a_partial_refund_gives_back_the_commission_in_proportion(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)

    assert _refund(fin, payment_id, 100000).status_code == 200  # 1 000 of 2 500 ₽
    _finish_refund(fin)

    refund = sql(fin.dsn, "SELECT amount_kopecks, commission_refund_kopecks, trainer_refund_kopecks FROM refunds")[0]
    assert (refund["amount_kopecks"], refund["commission_refund_kopecks"], refund["trainer_refund_kopecks"]) == (100000, 10000, 90000)
    assert sql_value(fin.dsn, "SELECT status FROM payments") == "partially_refunded"
    totals = ledger_totals(fin.dsn)
    assert (totals["provider_receivable"], totals["platform_revenue"], totals["trainer_pending"]) == (150000, 15000, 135000)
    assert player.ok("GET", "/api/bookings/me")[0]["payment_status"] == "paid"
    assert_books_are_sound(fin.dsn)


def test_refunds_can_never_exceed_the_payment_and_respect_the_providers_minimums(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)

    assert _refund(fin, payment_id, 99).status_code == 422              # under 1 ₽
    assert _refund(fin, payment_id, 250001).status_code == 422          # more than was paid
    assert _refund(fin, payment_id, 249950).status_code == 422          # would leave 0.50 ₽
    assert _refund(fin, payment_id, 150000).status_code == 200
    assert _refund(fin, payment_id, 100001).status_code == 422          # only 1 000 ₽ is left to refund
    assert _refund(fin, payment_id, 100000).status_code == 200
    assert _refund(fin, payment_id, 100).status_code == 422             # everything is already asked for
    assert sql_value(fin.dsn, "SELECT refund_reserved_kopecks FROM payments") == 250000
    assert _refund(fin, payment_id, 100000, reason="  ").status_code in (422,)


def test_simultaneous_refund_requests_cannot_exceed_the_payment(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    settings = get_settings()
    from app.services import refunds as refunds_service

    async def ask(n):
        conn = await asyncpg.connect(fin.dsn)
        try:
            await refunds_service.request_refund(conn, settings, payment_id=uuid.UUID(payment_id), amount_kopecks=250000, reason=f"r{n}", admin_user_id=uuid.UUID(fin.admin.user_id))
            return "ok"
        except Exception as exc:  # noqa: BLE001
            return getattr(exc, "code", type(exc).__name__)
        finally:
            await conn.close()

    async def together():
        return await asyncio.gather(*(ask(n) for n in range(6)))

    results = run(together())

    assert results.count("ok") == 1 and sql_value(fin.dsn, "SELECT count(*) FROM refunds") == 1
    assert sql_value(fin.dsn, "SELECT refund_reserved_kopecks FROM payments") == 250000


def test_a_refund_after_release_takes_the_money_from_the_available_balance(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release", json={})

    _refund(fin, payment_id, 100000)
    _finish_refund(fin)

    assert trainer_balances(fin.dsn, coach.user_id)["trainer_available"] == 135000 and ledger_totals(fin.dsn)["trainer_debt"] == 0
    assert_books_are_sound(fin.dsn)


def test_a_refund_after_money_was_reserved_or_paid_out_becomes_a_visible_debt(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release", json={})
    wid = ask_withdrawal(coach, 225000).json()["id"]              # all of it is now reserved for a payout

    _refund(fin, payment_id, 250000)
    _finish_refund(fin)

    balances = trainer_balances(fin.dsn, coach.user_id)
    assert (balances["trainer_reserved"], balances["trainer_available"], balances["trainer_debt"]) == (225000, 0, 225000)
    assert sql_value(fin.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'trainer_debt' AND status = 'open'") == 1
    assert coach.ok("GET", "/api/finance/summary")["debt_kopecks"] == 225000
    assert sql_value(fin.dsn, "SELECT status FROM withdrawal_requests WHERE id = $1::uuid", wid) == "requested"  # nothing was silently cancelled
    assert_books_are_sound(fin.dsn)


def test_a_refund_counts_only_when_the_provider_confirms_it(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    _refund(fin, payment_id, 100000)
    rid = next(iter(fin.provider.refunds))

    # a forged "refund.succeeded" for a refund that is still pending at the provider
    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200
    assert sql_value(fin.dsn, "SELECT status FROM refunds") == "pending" and sql_value(fin.dsn, "SELECT refunded_kopecks FROM payments") == 0
    # a refund of a different amount than requested is not applied either
    fin.provider.finish_refund(rid, "succeeded", amount={"value": "1.00", "currency": "RUB"})
    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200
    assert sql_value(fin.dsn, "SELECT status FROM refunds") == "pending" and sql_value(fin.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'refund_mismatch'") == 1
    fin.provider.finish_refund(rid, "succeeded", amount={"value": "1000.00", "currency": "RUB"})
    for _ in range(3):
        assert webhook(fin.world, rid, "refund.succeeded").status_code == 200
    assert sql_value(fin.dsn, "SELECT refunded_kopecks FROM payments") == 100000 and sql_value(fin.dsn, "SELECT count(*) FROM ledger_transactions WHERE kind = 'refund'") == 1


def test_a_canceled_refund_frees_the_amount_and_raises_an_incident(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    _refund(fin, payment_id, 100000)
    rid = next(iter(fin.provider.refunds))
    fin.provider.finish_refund(rid, "canceled", cancellation_details={"reason": "rejected_by_payee"})

    assert webhook(fin.world, rid, "refund.succeeded").status_code == 200

    assert sql_value(fin.dsn, "SELECT status FROM refunds") == "failed" and sql_value(fin.dsn, "SELECT refund_reserved_kopecks FROM payments") == 0
    assert sql_value(fin.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'refund_failed'") == 1
    assert _refund(fin, payment_id, 100000).status_code == 200  # the amount can be asked for again (a new key)


def test_refunds_are_for_finance_administrators_with_a_recent_second_factor(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)

    assert coach.call("POST", f"/api/admin/finance/payments/{payment_id}/refund", json={"amount_kopecks": 100000, "reason": "x"}).status_code == 403
    assert player.call("POST", f"/api/admin/finance/payments/{payment_id}/refund", json={"amount_kopecks": 100000, "reason": "x"}).status_code == 403
    fin.admin.fresh_session()
    assert _refund(fin, payment_id, 100000).json()["error"]["code"] == "mfa_required"
    assert fin.provider.refund_requests == []


def test_a_duplicate_charge_is_given_back_whole_without_touching_the_books(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    first = next(iter(fin.provider.payments))
    sql(fin.dsn, "UPDATE payment_attempts SET status = 'expired' WHERE provider_payment_id = $1", first)  # (as in the duplicate scenario)
    sql(fin.dsn, "INSERT INTO payment_attempts (payment_id, provider_payment_id, status) SELECT payment_id, 'dup-0002', 'pending' FROM payment_attempts LIMIT 1")
    fin.provider.payments["dup-0002"] = {"id": "dup-0002", "status": "succeeded", "paid": True, "amount": {"value": "2500.00", "currency": "RUB"},
                                         "metadata": {"booking_id": booking["id"]}, "_key": "k3", "confirmation": {}}
    sql(fin.dsn, "UPDATE payment_attempts SET status = 'succeeded' WHERE provider_payment_id = $1", first)
    webhook(fin.world, "dup-0002")
    dup_attempt = sql_value(fin.dsn, "SELECT id::text FROM payment_attempts WHERE provider_payment_id = 'dup-0002'")
    assert sql_value(fin.dsn, "SELECT status FROM payment_attempts WHERE provider_payment_id = 'dup-0002'") == "duplicate_paid"
    before = ledger_totals(fin.dsn)

    assert _refund(fin, payment_id, 100000, attempt_id=dup_attempt).status_code == 422  # a duplicate is refunded whole
    assert _refund(fin, payment_id, 250000, attempt_id=dup_attempt).status_code == 200
    rid = next(iter(fin.provider.refunds))
    fin.provider.finish_refund(rid)
    webhook(fin.world, rid, "refund.succeeded")

    assert sql_value(fin.dsn, "SELECT status FROM refunds") == "succeeded"
    assert ledger_totals(fin.dsn) == before and sql_value(fin.dsn, "SELECT status FROM payments") == "paid"  # the real payment is untouched
    assert _refund(fin, payment_id, 250000, attempt_id=dup_attempt).json()["error"]["code"] == "refund_exists"
    assert_books_are_sound(fin.dsn)


# --- the administrators' screens ---------------------------------------------------------------------------------------------


def test_the_overview_keeps_turnover_commission_and_obligations_apart(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    conduct(fin, coach, booking)
    fin.admin.ok("POST", f"/api/admin/finance/earnings/{earning_of(fin, booking)}/release", json={})
    coach2, player2, booking2, _ = paid_booking(fin, 2)

    data = fin.admin.ok("GET", "/api/admin/finance/overview")

    assert data["gross_received_kopecks"] == 500000 and data["platform_commission_kopecks"] == 50000
    assert data["owed_to_trainers"] == {"pending_kopecks": 225000, "available_kopecks": 225000, "reserved_kopecks": 0}
    assert data["held_by_provider_kopecks"] == 500000 and data["paid_out_kopecks"] == 0 and data["ledger_mismatches"] == 0
    assert data["provider_fees_kopecks"] is None and data["bank_receipts_kopecks"] is None  # not invented: they come from reports
    assert data["payments"]["payments_count"] == 2 and data["commission_percent"] == "10"
    assert fin.admin.ok("GET", "/api/admin/finance/integrity") == {"balanced": True, "mismatches": []}


def test_the_admin_lists_filter_and_paginate(fin) -> None:
    for n in range(3):
        paid_booking(fin, n)

    assert fin.admin.ok("GET", "/api/admin/finance/payments", params={"limit": 2})["total"] == 3
    assert len(fin.admin.ok("GET", "/api/admin/finance/payments", params={"limit": 2, "offset": 2})["items"]) == 1
    assert fin.admin.ok("GET", "/api/admin/finance/payments", params={"q": "coach1@example.com"})["total"] == 1
    assert fin.admin.ok("GET", "/api/admin/finance/payments", params={"status": "refunded"})["total"] == 0
    assert fin.admin.call("GET", "/api/admin/finance/payments", params={"status": "bogus"}).status_code == 422
    assert fin.admin.call("GET", "/api/admin/finance/payments", params={"limit": 1000}).status_code == 422
    assert fin.admin.ok("GET", "/api/admin/finance/earnings", params={"status": "pending"})["total"] == 3
    detail = fin.admin.ok("GET", f"/api/admin/finance/payments/{sql_value(fin.dsn, 'SELECT id::text FROM payments LIMIT 1')}")
    assert [a["status"] for a in detail["attempts"]] == ["succeeded"] and detail["earning"]["status"] == "pending" and len(detail["postings"]) == 1


def test_incidents_are_listed_and_can_be_closed_with_a_note(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    sql(fin.dsn, "INSERT INTO payment_incidents (kind, payment_id, detail) VALUES ('amount_mismatch', $1::uuid, 'проверка')", payment_id)
    listed = fin.admin.ok("GET", "/api/admin/finance/incidents", params={"status": "open"})
    assert listed["total"] == 1

    assert fin.admin.call("POST", f"/api/admin/finance/incidents/{listed['items'][0]['id']}/resolve", json={}).status_code == 422
    assert fin.admin.call("POST", f"/api/admin/finance/incidents/{listed['items'][0]['id']}/resolve", json={"resolution": "разобрались"}).status_code == 200
    assert fin.admin.call("POST", f"/api/admin/finance/incidents/{listed['items'][0]['id']}/resolve", json={"resolution": "ещё раз"}).status_code == 409
    assert fin.admin.ok("GET", "/api/admin/finance/incidents", params={"status": "open"})["total"] == 0


def test_the_whole_finance_section_is_closed_to_everyone_but_finance_administrators(fin) -> None:
    coach, player, booking, payment_id = paid_booking(fin)
    plain = {"/api/admin/finance/overview": "GET", "/api/admin/finance/payments": "GET", "/api/admin/finance/withdrawals": "GET",
             "/api/admin/finance/earnings": "GET", "/api/admin/finance/incidents": "GET", "/api/admin/finance/refunds": "GET", "/api/admin/finance/integrity": "GET"}
    for path, method in plain.items():
        fin.world.client.cookies.clear()
        assert fin.world.client.request(method, path).status_code == 401, path
        assert coach.call(method, path).status_code == 403, path
        assert player.call(method, path).status_code == 403, path
        assert fin.admin.call(method, path).status_code == 200, path
    reconfigure(fin, FINANCE_ADMIN_EMAILS="")   # empty list = nobody, not even an administrator
    for path, method in plain.items():
        assert fin.admin.call(method, path).status_code == 403, path


def test_the_account_owner_gets_a_security_email_without_any_requisites(fin) -> None:
    coach, player, booking, _ = paid_booking(fin)
    available_money(fin, coach.user_id, 400_000)
    before = len(fin.world.client.outbox)

    ask_withdrawal(coach, 150_000)

    mails = [m for m in fin.world.client.outbox[before:] if m.to == "coach0@example.com"]
    assert len(mails) == 1 and "заявка на вывод" in mails[0].text.lower() and "1 500,00 ₽" in mails[0].text.replace(" ", " ")
    assert "912" not in mails[0].text and "Сбербанк" not in mails[0].text
    ask_withdrawal(coach, 150_000, key=json.loads(json.dumps(str(uuid.uuid4()))))
    # (a repeated identical form would not mail again: see the idempotence test)
