"""Paying for a confirmed booking (ЮKassa) and what it does to the books. The provider is always a fake: no test talks to the real one."""
from __future__ import annotations

import base64
import json
from decimal import Decimal

import httpx
import pytest

from app.config import get_settings
from app.integrations import yookassa as yookassa_module
from app.integrations.yookassa import YooKassaClient, YooKassaError
from app.services import payments as payments_service
from app.services import reconcile
from tests.admin_world import live_client, pg, world  # noqa: F401  (fixtures)
from tests.finance_helpers import (
    SECRET, FakeProvider, assert_books_are_sound, confirmed_booking, enable_payments, ledger_totals, run, trainer_balances, webhook, with_conn,
)
from tests.live_helpers import Browser, sql, sql_value


@pytest.fixture
def provider(world, monkeypatch):  # noqa: F811
    fake = FakeProvider()
    enable_payments(monkeypatch, fake)
    return fake


def _mine(player, booking_id: str) -> dict:
    return next(b for b in player.ok("GET", "/api/bookings/me") if b["id"] == booking_id)


def _pay(player, booking_id: str):
    return player.call("POST", f"/api/bookings/{booking_id}/pay")


def _first_provider_id(provider) -> str:
    return next(iter(provider.payments))


# --- the chain: request -> confirm -> pay -> booked --------------------------------------------------------------------------


def test_the_full_chain_ends_with_a_paid_booking_and_a_pending_earning(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world)
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"
    assert _pay(player, booking["id"]).status_code == 409  # not confirmed yet: no payment can be created by a direct request
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"  # «Ожидает оплаты»

    started = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert started["confirmation_url"].startswith("https://")
    assert _mine(player, booking["id"])["payment_status"] == "processing"
    pid = _first_provider_id(provider)
    provider.finish(pid, "succeeded")
    assert webhook(world, pid).status_code == 200

    paid = _mine(player, booking["id"])
    assert paid["payment_status"] == "paid" and paid["paid_at"]
    assert coach.ok("GET", "/api/bookings/coach")[0]["payment_status"] == "paid"
    # the books: 2 500 ₽ received, 250 ₽ (10 %) the platform's, 2 250 ₽ owed to the trainer and still PENDING
    payment = sql(world.dsn, "SELECT * FROM payments")[0]
    assert (payment["gross_kopecks"], payment["platform_fee_kopecks"], payment["trainer_kopecks"], payment["status"]) == (250000, 25000, 225000, "paid")
    earning = sql(world.dsn, "SELECT * FROM trainer_earnings")[0]
    assert (earning["status"], earning["trainer_kopecks"], earning["session_confirmed_at"]) == ("pending", 225000, None)
    assert trainer_balances(world.dsn, coach.user_id)["trainer_pending"] == 225000
    totals = ledger_totals(world.dsn)
    assert (totals["provider_receivable"], totals["platform_revenue"], totals["trainer_available"]) == (250000, 25000, 0)
    assert _pay(player, booking["id"]).status_code == 409  # cannot be paid twice
    assert_books_are_sound(world.dsn)


def test_what_is_sent_to_the_provider_comes_from_the_booking_not_from_the_browser(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay", json={"amount": 1, "currency": "USD", "commission": 0, "gross_kopecks": 1})

    sent = provider.created[0]
    assert sent["amount_kopecks"] == 250000 and sent["currency"] == "RUB" and sent["receipt"] is None
    assert f"booking={booking['id']}" in sent["return_url"] and "/payments/return" in sent["return_url"]
    assert sent["metadata"]["booking_id"] == booking["id"]
    row = sql(world.dsn, "SELECT gross_kopecks, payer_user_id::text AS payer FROM payments")[0]
    assert (row["gross_kopecks"], row["payer"]) == (250000, player.user_id)


def test_the_commission_is_frozen_when_the_payment_is_created(world, provider, monkeypatch) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    monkeypatch.setenv("PLATFORM_COMMISSION_PERCENT", "30")  # the setting changes afterwards...
    get_settings.cache_clear()
    provider.finish(_first_provider_id(provider), "succeeded")

    assert webhook(world, _first_provider_id(provider)).status_code == 200

    row = sql(world.dsn, "SELECT commission_percent, platform_fee_kopecks FROM payments")[0]
    assert (row["commission_percent"], row["platform_fee_kopecks"]) == (Decimal("10.00"), 25000)  # ...the old obligation keeps its 10 %
    assert ledger_totals(world.dsn)["platform_revenue"] == 25000


def test_the_commission_percent_comes_only_from_the_server_configuration(world, provider, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("PLATFORM_COMMISSION_PERCENT", "7.5")
    get_settings.cache_clear()
    coach, player, booking = confirmed_booking(world, confirm=True)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    row = sql(world.dsn, "SELECT platform_fee_kopecks, trainer_kopecks FROM payments")[0]
    assert (row["platform_fee_kopecks"], row["trainer_kopecks"]) == (18750, 231250)


def test_a_fiscal_receipt_is_sent_only_when_switched_on(world, provider, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("YOOKASSA_SEND_RECEIPT", "true")
    get_settings.cache_clear()
    coach, player, booking = confirmed_booking(world, confirm=True)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    receipt = provider.created[0]["receipt"]
    assert receipt["customer"] == {"email": "player@example.com"}
    assert receipt["items"][0]["amount"] == {"value": "2500.00", "currency": "RUB"} and receipt["items"][0]["payment_subject"] == "service"


def test_pressing_pay_twice_gives_the_same_page_and_one_payment(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)

    first = player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    second = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert first == second and len(provider.created) == 1
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 1 and sql_value(world.dsn, "SELECT count(*) FROM payment_attempts") == 1


def test_pressing_pay_is_the_acceptance_of_the_standard_terms_and_is_recorded_once(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    rows = sql(world.dsn, "SELECT role, email, documents::text AS docs, booking_id::text AS booking, ip_address FROM legal_acceptances WHERE consent_key = 'service_terms_payment'")
    assert len(rows) == 1 and rows[0]["role"] == "player" and rows[0]["booking"] == booking["id"] and rows[0]["ip_address"]
    assert json.loads(rows[0]["docs"])[0]["key"] == "service-terms" and json.loads(rows[0]["docs"])[0]["version"]


# --- who may pay, and when ---------------------------------------------------------------------------------------------------


def test_only_the_athlete_of_a_confirmed_booking_can_pay(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world)
    stranger = Browser(world.client, "stranger@example.com", "Чужой", "player")

    assert _pay(player, booking["id"]).status_code == 409
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    assert _pay(stranger, booking["id"]).status_code == 404
    assert _pay(coach, booking["id"]).status_code == 404
    world.client.cookies.clear()
    assert world.client.post(f"/api/bookings/{booking['id']}/pay").status_code == 401
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 0 and provider.created == []


def test_a_declined_closed_or_cancelled_booking_cannot_be_paid(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world)
    coach.ok("POST", f"/api/bookings/{booking['id']}/decline")
    assert _pay(player, booking["id"]).status_code == 409

    coach2, player2, booking2 = confirmed_booking(world, coach_email="coach2@example.com", player_email="player2@example.com", title="Плавание", confirm=True)
    sql(world.dsn, "UPDATE bookings SET starts_at = now() - interval '3 hours' WHERE id = $1::uuid", booking2["id"])
    closed = _pay(player2, booking2["id"])
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "booking_closed"

    coach3, player3, booking3 = confirmed_booking(world, coach_email="coach3@example.com", player_email="player3@example.com", title="Бокс", confirm=True)
    sql(world.dsn, "UPDATE trainings SET status = 'cancelled' WHERE id = (SELECT training_id FROM bookings WHERE id = $1::uuid)", booking3["id"])
    assert _pay(player3, booking3["id"]).status_code == 409
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 0


def test_a_free_session_asks_for_no_payment(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    sql(world.dsn, "UPDATE bookings SET price_per_session = NULL WHERE id = $1::uuid", booking["id"])

    assert _mine(player, booking["id"])["payment_status"] == "not_required"
    response = _pay(player, booking["id"])
    assert response.status_code == 409 and response.json()["error"]["code"] == "nothing_to_pay"


def test_nothing_is_offered_while_payments_are_switched_off(world, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("YOOKASSA_ENABLED", "false")
    monkeypatch.setenv("YOOKASSA_SHOP_ID", "123456")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", SECRET)
    get_settings.cache_clear()
    coach, player, booking = confirmed_booking(world, confirm=True)

    response = _pay(player, booking["id"])

    assert response.status_code == 503 and response.json()["error"]["code"] == "payments_unavailable"
    assert world.client.get("/api/features").json()["payments"] is False
    assert world.client.post("/api/payments/yookassa/webhook", json={"event": "payment.succeeded", "object": {"id": "x"}}).json() == {"ok": True}


def test_the_site_says_payments_are_on_once_enabled_and_configured(world, provider) -> None:  # noqa: F811
    assert world.client.get("/api/features").json()["payments"] is True


def test_the_balance_and_withdrawal_flags_reach_the_site_and_withdrawals_need_the_balance(world, monkeypatch) -> None:  # noqa: F811
    for name in ("TRAINER_BALANCE_ENABLED", "TRAINER_WITHDRAWALS_ENABLED"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    features = world.client.get("/api/features").json()
    assert (features["trainer_balance"], features["trainer_withdrawals"]) == (False, False)  # everything is off by default

    monkeypatch.setenv("TRAINER_WITHDRAWALS_ENABLED", "true")
    get_settings.cache_clear()
    features = world.client.get("/api/features").json()
    assert (features["trainer_balance"], features["trainer_withdrawals"]) == (False, False)  # withdrawals alone show nothing

    monkeypatch.setenv("TRAINER_BALANCE_ENABLED", "true")
    get_settings.cache_clear()
    features = world.client.get("/api/features").json()
    assert (features["trainer_balance"], features["trainer_withdrawals"]) == (True, True)


# --- the provider decides, never the browser ---------------------------------------------------------------------------------


def test_a_forged_notification_cannot_mark_anything_paid(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    # The body claims success; the provider (the only authority) says the payment is still open.
    assert webhook(world, _first_provider_id(provider)).status_code == 200

    assert _mine(player, booking["id"])["payment_status"] == "processing"
    assert sql_value(world.dsn, "SELECT status FROM payments") == "awaiting" and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 0


def test_a_success_for_a_different_amount_currency_or_booking_is_not_applied(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = _first_provider_id(provider)

    for change in ({"amount": {"value": "1.00", "currency": "RUB"}}, {"amount": {"value": "2500.00", "currency": "USD"}},
                   {"amount": {"value": "2500.00", "currency": "RUB"}, "metadata": {"booking_id": "00000000-0000-0000-0000-000000000001"}}):
        provider.finish(pid, "succeeded", **change)
        assert webhook(world, pid).status_code == 200
        assert sql_value(world.dsn, "SELECT status FROM payments") == "awaiting" and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 0
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'amount_mismatch'") == 1  # one open problem, recorded once

    provider.finish(pid, "succeeded", amount={"value": "2500.00", "currency": "RUB"}, metadata={"booking_id": booking["id"]})
    assert webhook(world, pid).status_code == 200
    assert sql_value(world.dsn, "SELECT status FROM payments") == "paid"


def test_repeated_notifications_account_the_payment_once(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = _first_provider_id(provider)
    provider.finish(pid, "succeeded")

    for _ in range(4):
        assert webhook(world, pid).status_code == 200

    assert sql_value(world.dsn, "SELECT count(*) FROM trainer_earnings") == 1 and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 1
    assert trainer_balances(world.dsn, coach.user_id)["trainer_pending"] == 225000 and ledger_totals(world.dsn)["platform_revenue"] == 25000
    notes = sql(world.dsn, "SELECT category, count(*) AS n FROM notifications WHERE category IN ('payment_update', 'earning_update') GROUP BY category")
    assert {r["category"]: r["n"] for r in notes} == {"payment_update": 1, "earning_update": 1}  # one message each, however many deliveries


def test_simultaneous_confirmations_account_the_payment_once(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "succeeded")
    settings = get_settings()

    async def confirm_once():
        async def work(conn):
            attempt = (await conn.fetchrow("SELECT * FROM payment_attempts"))
            return await payments_service.sync_attempt(conn, settings, dict(attempt), source="webhook")

        return await with_conn(world.dsn, work)

    async def together():
        import asyncio

        return await asyncio.gather(*(confirm_once() for _ in range(8)), return_exceptions=True)

    results = run(together())

    assert not [r for r in results if isinstance(r, Exception)]
    assert sql_value(world.dsn, "SELECT count(*) FROM trainer_earnings") == 1 and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 1
    assert ledger_totals(world.dsn)["provider_receivable"] == 250000
    assert_books_are_sound(world.dsn)


def test_the_athlete_returning_from_the_payment_page_can_refresh_the_status(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "succeeded")  # no webhook arrived (yet)

    synced = player.ok("POST", f"/api/bookings/{booking['id']}/payment/sync")

    assert synced["payment_status"] == "paid"
    stranger = Browser(world.client, "stranger@example.com", "Чужой", "player")
    assert stranger.call("POST", f"/api/bookings/{booking['id']}/payment/sync").status_code == 404


def test_an_abandoned_payment_can_be_started_again_and_the_player_is_told(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    first = player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "canceled", cancellation_details={"party": "yoo_money", "reason": "expired_on_confirmation"})
    assert webhook(world, _first_provider_id(provider), "payment.canceled").status_code == 200
    assert _mine(player, booking["id"])["payment_status"] == "canceled"  # «Платёж отменён»
    assert sql_value(world.dsn, "SELECT count(*) FROM notifications WHERE category = 'payment_update'") == 1

    second = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert second["confirmation_url"] != first["confirmation_url"] and len(provider.created) == 2
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_attempts WHERE status = 'canceled'") == 1
    assert sql_value(world.dsn, "SELECT cancellation_reason FROM payment_attempts WHERE status = 'canceled'") == "expired_on_confirmation"
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 1  # still ONE obligation, with the same frozen amounts


def test_a_cancelled_attempt_never_creates_an_earning(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "canceled", cancellation_details={"reason": "permission_revoked"})

    webhook(world, _first_provider_id(provider), "payment.canceled")

    assert sql_value(world.dsn, "SELECT count(*) FROM trainer_earnings") == 0 and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 0


@pytest.mark.parametrize("late_first", [True, False])
def test_a_second_real_charge_is_an_incident_not_a_second_earning(world, provider, late_first) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    first = _first_provider_id(provider)
    # The first page was given up locally (expired), a second attempt was opened ... and then BOTH were paid at the provider.
    sql(world.dsn, "UPDATE payment_attempts SET status = 'expired' WHERE provider_payment_id = $1", first)
    sql(world.dsn, "INSERT INTO payment_attempts (payment_id, provider_payment_id, status) SELECT payment_id, 'dup-0001', 'pending' FROM payment_attempts LIMIT 1")
    provider.payments["dup-0001"] = {"id": "dup-0001", "status": "pending", "paid": False, "amount": {"value": "2500.00", "currency": "RUB"},
                                     "metadata": {"booking_id": booking["id"]}, "_key": "k2", "confirmation": {}}
    provider.finish(first, "succeeded")
    provider.finish("dup-0001", "succeeded")
    order = ("dup-0001", first) if late_first else (first, "dup-0001")

    for provider_id in order:
        assert webhook(world, provider_id).status_code == 200

    assert sql_value(world.dsn, "SELECT count(*) FROM trainer_earnings") == 1 and sql_value(world.dsn, "SELECT count(*) FROM ledger_transactions") == 1
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_attempts WHERE status = 'succeeded'") == 1
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_attempts WHERE status = 'duplicate_paid'") == 1
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'duplicate_payment' AND status = 'open'") == 1
    assert ledger_totals(world.dsn)["provider_receivable"] == 250000  # the second charge was never booked as income
    assert_books_are_sound(world.dsn)


def test_a_payment_for_a_booking_that_was_closed_meanwhile_is_booked_and_flagged(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    sql(world.dsn, "UPDATE trainings SET status = 'cancelled' WHERE id = (SELECT training_id FROM bookings WHERE id = $1::uuid)", booking["id"])
    provider.finish(_first_provider_id(provider), "succeeded")

    webhook(world, _first_provider_id(provider))

    assert sql_value(world.dsn, "SELECT status FROM payments") == "paid"  # the money is real: it is recorded, never hidden
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'paid_booking_closed'") == 1


# --- the provider misbehaving ------------------------------------------------------------------------------------------------


def test_a_refused_request_leaves_the_booking_free_to_try_again(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    provider.fail_next = YooKassaError("ЮKassa answered 400 invalid_request", status_code=400, retryable=False)

    failed = _pay(player, booking["id"])

    assert failed.status_code == 502 and failed.json()["error"]["code"] == "payment_provider_error" and SECRET not in failed.text
    assert _mine(player, booking["id"])["payment_status"] == "canceled"
    assert _pay(player, booking["id"]).status_code == 200


def test_an_unknown_outcome_is_retried_with_the_same_idempotence_key(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    provider.fail_next = YooKassaError("ЮKassa is unreachable (ConnectTimeout)", retryable=True)

    assert _pay(player, booking["id"]).status_code == 502
    key = sql_value(world.dsn, "SELECT idempotence_key::text FROM payment_attempts")
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"  # no page exists yet

    assert _pay(player, booking["id"]).status_code == 200
    assert provider.created[0]["idempotence_key"] == key and sql_value(world.dsn, "SELECT count(*) FROM payment_attempts") == 1


def test_a_lost_webhook_is_recovered_by_reconciliation(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "succeeded")  # ...and no notification ever arrives
    settings = get_settings()

    too_young = run(with_conn(world.dsn, lambda c: reconcile.reconcile_payments(c, settings)))
    assert too_young["checked"] == 0  # the webhook still has its chance

    sql(world.dsn, "UPDATE payment_attempts SET created_at = now() - interval '10 minutes'")
    stats = run(with_conn(world.dsn, lambda c: reconcile.reconcile_payments(c, settings)))

    assert stats["checked"] == 1 and sql_value(world.dsn, "SELECT status FROM payments") == "paid"
    assert sql_value(world.dsn, "SELECT count(*) FROM trainer_earnings") == 1
    again = run(with_conn(world.dsn, lambda c: reconcile.reconcile_payments(c, settings)))
    assert again["checked"] == 0  # finished attempts are not asked about again


def test_reconciliation_is_bounded_and_survives_the_provider_being_down(world, provider, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("PAYMENT_RECONCILE_BATCH", "2")
    get_settings.cache_clear()
    for n in range(4):
        coach, player, booking = confirmed_booking(world, coach_email=f"c{n}@example.com", player_email=f"p{n}@example.com", title=f"Спорт {n}", confirm=True)
        player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    sql(world.dsn, "UPDATE payment_attempts SET created_at = now() - interval '10 minutes'")
    provider.unreachable = True
    settings = get_settings()

    stats = run(with_conn(world.dsn, lambda c: reconcile.reconcile_payments(c, settings)))

    assert stats["checked"] == 2 and stats["errors"] == 2  # a limited batch, and errors do not escape
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_attempts WHERE check_count > 0") == 2
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_attempts WHERE status IN ('created', 'pending')") == 4


def test_an_old_unanswered_request_is_not_resent_blindly(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    provider.fail_next = YooKassaError("ЮKassa is unreachable", retryable=True)
    _pay(player, booking["id"])
    sql(world.dsn, "UPDATE payment_attempts SET created_at = now() - interval '30 hours'")
    settings = get_settings()

    run(with_conn(world.dsn, lambda c: reconcile.reconcile_payments(c, settings)))

    assert sql_value(world.dsn, "SELECT status FROM payment_attempts") == "expired"
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_incidents WHERE kind = 'reconcile_gap'") == 1 and provider.created == []


# --- the public webhook -----------------------------------------------------------------------------------------------------


def test_the_webhook_needs_no_login_but_refuses_garbage_and_ignores_strangers(world, provider) -> None:  # noqa: F811
    world.client.cookies.clear()
    url = "/api/payments/yookassa/webhook"

    assert world.client.post(url, content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert world.client.post(url, json={"event": "payment.succeeded", "object": {}}).status_code == 400
    assert world.client.post(url, json={"event": "payment.succeeded", "object": {"id": "../../etc/passwd"}}).status_code == 400
    assert world.client.post(url, json=["x"]).status_code == 400
    assert world.client.post(url, content=b"{" + b"x" * 70000, headers={"Content-Type": "application/json"}).status_code == 413
    assert world.client.post(url, json={"event": "payment.succeeded", "object": {"id": "2f000000-000f-5000-9000-ffffffffffff"}}).json() == {"ok": True}
    assert world.client.post(url, json={"event": "deal.closed", "object": {"id": "abc"}}).json() == {"ok": True}
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 0
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_events WHERE outcome IN ('unknown_object', 'ignored_event')") == 2


def test_the_webhook_asks_the_provider_to_retry_when_it_cannot_verify(world, provider) -> None:  # noqa: F811
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = _first_provider_id(provider)
    provider.finish(pid, "succeeded")
    provider.unreachable = True

    assert webhook(world, pid).status_code == 502  # not 200: ЮKassa will deliver again (for 24 hours)
    assert sql_value(world.dsn, "SELECT status FROM payments") == "awaiting"
    provider.unreachable = False
    assert webhook(world, pid).status_code == 200 and sql_value(world.dsn, "SELECT status FROM payments") == "paid"


def test_the_source_address_check_refuses_strangers_when_enabled(world, provider, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("YOOKASSA_WEBHOOK_IP_CHECK", "true")
    get_settings.cache_clear()
    coach, player, booking = confirmed_booking(world, confirm=True)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(_first_provider_id(provider), "succeeded")

    refused = webhook(world, _first_provider_id(provider))

    assert refused.status_code == 403 and sql_value(world.dsn, "SELECT status FROM payments") == "awaiting"
    assert sql_value(world.dsn, "SELECT count(*) FROM payment_events WHERE outcome = 'refused_source'") == 1


@pytest.mark.parametrize("address,allowed", [
    ("185.71.76.5", True), ("185.71.77.31", True), ("77.75.153.100", True), ("77.75.156.11", True), ("77.75.156.35", True),
    ("77.75.154.200", True), ("2a02:5180::1", True), ("185.71.76.40", False), ("77.75.156.12", False), ("8.8.8.8", False),
    ("127.0.0.1", False), ("not-an-ip", False), ("", False), ("2001:db8::1", False),
])
def test_the_published_address_ranges(address, allowed) -> None:
    assert payments_service.ip_is_from_yookassa(address) is allowed


# --- the client itself (against a mock transport) ---------------------------------------------------------------------------


def _client_with(monkeypatch, handler) -> YooKassaClient:
    real = httpx.AsyncClient
    monkeypatch.setenv("YOOKASSA_ENABLED", "true")
    monkeypatch.setenv("YOOKASSA_SHOP_ID", "123456")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", SECRET)
    get_settings.cache_clear()
    monkeypatch.setattr(yookassa_module.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return YooKassaClient(get_settings())


@pytest.mark.asyncio
async def test_the_client_authenticates_sends_an_idempotence_key_and_exact_amounts(monkeypatch) -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(headers=dict(request.headers), body=json.loads(request.content), url=str(request.url))
        return httpx.Response(200, json={"id": "p1", "status": "pending"})

    client = _client_with(monkeypatch, handler)
    await client.create_payment(amount_kopecks=250005, currency="RUB", description="d" * 300, return_url="https://x.test/?b=1", idempotence_key="key-1", metadata={"booking_id": "b"})

    assert seen["url"].endswith("/payments") and seen["headers"]["idempotence-key"] == "key-1"
    assert seen["headers"]["authorization"] == "Basic " + base64.b64encode(f"123456:{SECRET}".encode()).decode()
    assert seen["body"]["amount"] == {"value": "2500.05", "currency": "RUB"} and seen["body"]["capture"] is True
    assert seen["body"]["confirmation"] == {"type": "redirect", "return_url": "https://x.test/?b=1"} and len(seen["body"]["description"]) <= 128


@pytest.mark.asyncio
@pytest.mark.parametrize("status,retryable", [(400, False), (401, False), (404, False), (429, True), (500, True), (503, True)])
async def test_the_client_tells_retryable_failures_from_final_ones_and_never_leaks_the_key(monkeypatch, status, retryable) -> None:
    client = _client_with(monkeypatch, lambda request: httpx.Response(status, json={"code": "invalid_request", "description": "nope"}))

    with pytest.raises(YooKassaError) as raised:
        await client.get_payment("p1")

    assert raised.value.retryable is retryable and raised.value.status_code == status
    assert SECRET not in str(raised.value) and "123456" not in str(raised.value)


@pytest.mark.asyncio
async def test_the_client_treats_a_network_failure_as_an_unknown_outcome(monkeypatch) -> None:
    def handler(request):
        raise httpx.ConnectTimeout("boom", request=request)

    client = _client_with(monkeypatch, handler)

    with pytest.raises(YooKassaError) as raised:
        await client.get_payment("p1")

    assert raised.value.retryable is True and SECRET not in str(raised.value)
