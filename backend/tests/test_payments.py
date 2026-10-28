"""Paying for a confirmed booking (ЮKassa). The provider is always a fake here: no test talks to the real one."""
from __future__ import annotations

import base64
import json
from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest

from app.config import get_settings
from app.integrations import yookassa as yookassa_module
from app.integrations.yookassa import YooKassaClient, YooKassaError
from tests.admin_world import live_client, pg, publish_listing, world  # noqa: F401  (fixtures)
from tests.live_helpers import Browser, sql, sql_value

SECRET = "live_test_secret_key_value"
_MONDAY = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)


class FakeProvider:
    """Stands in for ЮKassa: remembers what it was asked and lets a test decide how each payment ends."""

    def __init__(self) -> None:
        self.created: list[dict] = []
        self.payments: dict[str, dict] = {}
        self.fail_next: YooKassaError | None = None

    async def create_payment(self, *, amount, currency, description, return_url, idempotence_key, metadata, receipt=None):
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        existing = next((p for p in self.payments.values() if p["_key"] == idempotence_key), None)
        if existing is not None:  # idempotent, like the real thing
            return existing
        pid = f"2f{len(self.payments):06d}-000f-5000-9000-1a2b3c4d5e6f"
        payment = {
            "id": pid, "status": "pending", "paid": False, "amount": {"value": f"{amount:.2f}", "currency": currency},
            "confirmation": {"type": "redirect", "confirmation_url": f"https://yoomoney.ru/checkout/payments/v2/contract?orderId={pid}"},
            "_key": idempotence_key,
        }
        self.payments[pid] = payment
        self.created.append({"amount": amount, "currency": currency, "description": description, "return_url": return_url,
                             "idempotence_key": idempotence_key, "metadata": metadata, "receipt": receipt})
        return {k: v for k, v in payment.items() if k != "_key"}

    async def get_payment(self, provider_payment_id):
        return {k: v for k, v in self.payments[provider_payment_id].items() if k != "_key"}

    def finish(self, pid: str, status: str, **changes) -> None:
        self.payments[pid].update({"status": status, "paid": status == "succeeded", **changes})


@pytest.fixture
def provider(world, monkeypatch):  # noqa: F811
    monkeypatch.setenv("YOOKASSA_SHOP_ID", "123456")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", SECRET)
    get_settings.cache_clear()
    fake = FakeProvider()
    monkeypatch.setattr("app.services.payments.get_client", lambda settings: fake)
    return fake


def _confirmed_booking(world):  # noqa: F811
    coach = Browser(world.client, "coach@example.com", "Тренер", "coach")
    listing = publish_listing(coach)
    player = Browser(world.client, "player@example.com", "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    return coach, player, booking


def _confirm(coach, booking) -> None:
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")


def _mine(player, booking_id: str) -> dict:
    return next(b for b in player.ok("GET", "/api/bookings/me") if b["id"] == booking_id)


def _webhook(world, provider_id: str, event: str = "payment.succeeded"):  # noqa: F811
    world.client.cookies.clear()
    return world.client.post("/api/payments/yookassa/webhook", json={"type": "notification", "event": event, "object": {"id": provider_id, "status": "succeeded"}})


# --- the chain: request -> confirm -> pay ------------------------------------------------------------------------------


def test_the_full_chain_ends_with_a_paid_booking(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    assert _mine(player, booking["id"])["status"] == "pending"
    _confirm(coach, booking)
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"  # the «Оплатить» button appears

    started = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert started["confirmation_url"].startswith("https://")
    assert _mine(player, booking["id"])["payment_status"] == "pending"
    pid = next(iter(provider.payments))
    provider.finish(pid, "succeeded")
    assert _webhook(world, pid).status_code == 200

    paid = _mine(player, booking["id"])
    assert paid["payment_status"] == "paid" and paid["paid_at"]
    assert coach.ok("GET", "/api/bookings/coach")[0]["payment_status"] == "paid"
    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 409  # cannot be paid twice


def test_what_is_sent_to_the_provider_comes_from_the_booking_not_from_the_browser(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay", json={"amount": 1, "currency": "USD"})  # ignored

    sent = provider.created[0]
    assert sent["amount"] == Decimal("2500.00") and sent["currency"] == "RUB"
    assert f"id={booking['id']}" in sent["return_url"] and "open=booking_decided" in sent["return_url"]
    assert sent["metadata"]["booking_id"] == booking["id"]
    assert sent["receipt"] is None  # not switched on
    row = sql(world.dsn, "SELECT amount, currency, status, payer_user_id::text AS payer FROM payments")[0]
    assert (row["amount"], row["currency"], row["status"], row["payer"]) == (Decimal("2500.00"), "RUB", "pending", player.user_id)


def test_a_fiscal_receipt_is_sent_only_when_switched_on(world, provider, monkeypatch) -> None:  # noqa: F811
    monkeypatch.setenv("YOOKASSA_SEND_RECEIPT", "true")
    get_settings.cache_clear()
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    receipt = provider.created[0]["receipt"]
    assert receipt["customer"] == {"email": "player@example.com"}
    assert receipt["items"][0]["amount"] == {"value": "2500.00", "currency": "RUB"}
    assert receipt["items"][0]["payment_subject"] == "service"


def test_pressing_pay_twice_gives_the_same_page_and_one_payment(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)

    first = player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    second = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert first == second
    assert len(provider.created) == 1 and sql_value(world.dsn, "SELECT count(*) FROM payments") == 1


def test_pressing_pay_is_the_acceptance_of_the_standard_terms_and_is_recorded_once(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)

    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    rows = sql(world.dsn, "SELECT consent_key, role, email, documents::text AS docs, booking_id::text AS booking, ip_address "
                          "FROM legal_acceptances WHERE consent_key = 'service_terms_payment'")
    assert len(rows) == 1
    assert rows[0]["role"] == "player" and rows[0]["email"] == "player@example.com" and rows[0]["booking"] == booking["id"]
    assert json.loads(rows[0]["docs"])[0]["key"] == "service-terms" and json.loads(rows[0]["docs"])[0]["version"] and rows[0]["ip_address"]


# --- who may pay, and when ---------------------------------------------------------------------------------------------


def test_only_the_athlete_of_a_confirmed_booking_can_pay(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    stranger = Browser(world.client, "stranger@example.com", "Чужой", "player")

    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 409  # not confirmed yet
    _confirm(coach, booking)
    assert stranger.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 404
    assert coach.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 404
    world.client.cookies.clear()
    assert world.client.post(f"/api/bookings/{booking['id']}/pay").status_code == 401
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 0
    assert provider.created == []


def test_a_declined_or_closed_booking_cannot_be_paid(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    coach.ok("POST", f"/api/bookings/{booking['id']}/decline")
    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 409

    coach2, player2, booking2 = _second_booking(world)
    sql(world.dsn, "UPDATE bookings SET starts_at = now() - interval '3 hours' WHERE id = $1::uuid", booking2["id"])
    closed = player2.call("POST", f"/api/bookings/{booking2['id']}/pay")
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "booking_closed"


def _second_booking(world):  # noqa: F811
    coach = Browser(world.client, "coach2@example.com", "Тренер2", "coach")
    listing = publish_listing(coach, "Плавание")
    player = Browser(world.client, "player2@example.com", "Игрок2", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Пётр", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": _MONDAY.isoformat(), "to_date": _MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    return coach, player, booking


def test_a_free_session_asks_for_no_payment(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    sql(world.dsn, "UPDATE bookings SET price_per_session = NULL WHERE id = $1::uuid", booking["id"])

    assert _mine(player, booking["id"])["payment_status"] == "not_required"
    response = player.call("POST", f"/api/bookings/{booking['id']}/pay")
    assert response.status_code == 409 and response.json()["error"]["code"] == "nothing_to_pay"


def test_nothing_is_offered_while_the_shop_is_not_configured(world, monkeypatch) -> None:  # noqa: F811
    monkeypatch.delenv("YOOKASSA_SHOP_ID", raising=False)
    monkeypatch.delenv("YOOKASSA_SECRET_KEY", raising=False)
    get_settings.cache_clear()
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)

    response = player.call("POST", f"/api/bookings/{booking['id']}/pay")

    assert response.status_code == 503 and response.json()["error"]["code"] == "payments_unavailable"
    assert world.client.get("/api/features").json()["payments"] is False


def test_the_site_says_payments_are_on_once_configured(world, provider) -> None:  # noqa: F811
    assert world.client.get("/api/features").json()["payments"] is True


# --- the provider decides, never the browser ---------------------------------------------------------------------------


def test_a_forged_notification_cannot_mark_anything_paid(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(iter(provider.payments))

    # The body claims success; the provider (the only authority) says the payment is still open.
    assert _webhook(world, pid).status_code == 200

    assert _mine(player, booking["id"])["payment_status"] == "pending"
    assert sql_value(world.dsn, "SELECT status FROM payments") == "pending"


def test_a_success_for_a_different_amount_or_currency_is_not_applied(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(iter(provider.payments))

    provider.finish(pid, "succeeded", amount={"value": "1.00", "currency": "RUB"})
    assert _webhook(world, pid).status_code == 200
    assert sql_value(world.dsn, "SELECT status FROM payments") == "pending"

    provider.finish(pid, "succeeded", amount={"value": "2500.00", "currency": "USD"})
    assert _webhook(world, pid).status_code == 200
    assert sql_value(world.dsn, "SELECT status FROM payments") == "pending"

    provider.finish(pid, "succeeded", amount={"value": "2500.00", "currency": "RUB"})
    assert _webhook(world, pid).status_code == 200
    assert sql_value(world.dsn, "SELECT status FROM payments") == "succeeded"


def test_repeated_notifications_apply_once(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(iter(provider.payments))
    provider.finish(pid, "succeeded")

    for _ in range(3):
        assert _webhook(world, pid).status_code == 200

    assert sql_value(world.dsn, "SELECT count(*) FROM payments WHERE status = 'succeeded'") == 1


def test_the_athlete_returning_from_the_payment_page_can_refresh_the_status(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(next(iter(provider.payments)), "succeeded")  # no webhook arrived (yet)

    synced = player.ok("POST", f"/api/bookings/{booking['id']}/payment/sync")

    assert synced["payment_status"] == "paid"
    stranger = Browser(world.client, "stranger@example.com", "Чужой", "player")
    assert stranger.call("POST", f"/api/bookings/{booking['id']}/payment/sync").status_code == 404


def test_an_abandoned_payment_can_be_started_again(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    first = player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    provider.finish(next(iter(provider.payments)), "canceled", cancellation_details={"party": "yoo_money", "reason": "expired_on_confirmation"})

    second = player.ok("POST", f"/api/bookings/{booking['id']}/pay")

    assert second["confirmation_url"] != first["confirmation_url"] and len(provider.created) == 2
    assert sql_value(world.dsn, "SELECT count(*) FROM payments WHERE status = 'canceled'") == 1
    assert sql_value(world.dsn, "SELECT cancellation_reason FROM payments WHERE status = 'canceled'") == "expired_on_confirmation"


# --- the provider misbehaving ------------------------------------------------------------------------------------------


def test_a_refused_request_leaves_the_booking_free_to_try_again(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    provider.fail_next = YooKassaError("ЮKassa answered 400 invalid_request", status_code=400, retryable=False)

    failed = player.call("POST", f"/api/bookings/{booking['id']}/pay")

    assert failed.status_code == 502 and failed.json()["error"]["code"] == "payment_provider_error"
    assert SECRET not in failed.text
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"
    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 200


def test_an_unknown_outcome_is_retried_with_the_same_idempotence_key(world, provider) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    provider.fail_next = YooKassaError("ЮKassa is unreachable (ConnectTimeout)", retryable=True)

    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 502
    key = sql_value(world.dsn, "SELECT idempotence_key::text FROM payments")
    assert _mine(player, booking["id"])["payment_status"] == "unpaid"  # no page exists yet

    assert player.call("POST", f"/api/bookings/{booking['id']}/pay").status_code == 200
    assert provider.created[0]["idempotence_key"] == key and sql_value(world.dsn, "SELECT count(*) FROM payments") == 1


# --- the public webhook ------------------------------------------------------------------------------------------------


def test_the_webhook_needs_no_login_but_refuses_garbage_and_ignores_strangers(world, provider) -> None:  # noqa: F811
    world.client.cookies.clear()
    url = "/api/payments/yookassa/webhook"

    assert world.client.post(url, content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert world.client.post(url, json={"object": {}}).status_code == 400
    assert world.client.post(url, json={"object": {"id": "../../etc/passwd"}}).status_code == 400
    assert world.client.post(url, json=["x"]).status_code == 400
    assert world.client.post(url, content=b"{" + b"x" * 70000, headers={"Content-Type": "application/json"}).status_code == 413
    assert world.client.post(url, json={"object": {"id": "2f000000-000f-5000-9000-ffffffffffff"}}).json() == {"ok": True}
    assert sql_value(world.dsn, "SELECT count(*) FROM payments") == 0


def test_the_webhook_asks_the_provider_to_retry_when_it_cannot_verify(world, provider, monkeypatch) -> None:  # noqa: F811
    coach, player, booking = _confirmed_booking(world)
    _confirm(coach, booking)
    player.ok("POST", f"/api/bookings/{booking['id']}/pay")
    pid = next(iter(provider.payments))

    async def broken(provider_payment_id):
        raise YooKassaError("ЮKassa answered 503", status_code=503, retryable=True)

    monkeypatch.setattr(provider, "get_payment", broken)

    assert _webhook(world, pid).status_code == 502
    assert sql_value(world.dsn, "SELECT status FROM payments") == "pending"


# --- the client itself (against a mock transport) ----------------------------------------------------------------------


def _client_with(monkeypatch, handler) -> YooKassaClient:
    real = httpx.AsyncClient
    monkeypatch.setenv("YOOKASSA_SHOP_ID", "123456")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", SECRET)
    get_settings.cache_clear()
    monkeypatch.setattr(yookassa_module.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return YooKassaClient(get_settings())


@pytest.mark.asyncio
async def test_the_client_authenticates_and_sends_an_idempotence_key(monkeypatch) -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(headers=dict(request.headers), body=json.loads(request.content), url=str(request.url))
        return httpx.Response(200, json={"id": "p1", "status": "pending"})

    client = _client_with(monkeypatch, handler)
    await client.create_payment(amount=Decimal("2500"), currency="RUB", description="d" * 300, return_url="https://x.test/?open=1",
                                idempotence_key="key-1", metadata={"booking_id": "b"})

    assert seen["url"].endswith("/payments") and seen["headers"]["idempotence-key"] == "key-1"
    assert seen["headers"]["authorization"] == "Basic " + base64.b64encode(f"123456:{SECRET}".encode()).decode()
    assert seen["body"]["amount"] == {"value": "2500.00", "currency": "RUB"} and seen["body"]["capture"] is True
    assert seen["body"]["confirmation"] == {"type": "redirect", "return_url": "https://x.test/?open=1"}
    assert len(seen["body"]["description"]) <= 128


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
