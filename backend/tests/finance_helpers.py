"""Shared pieces for the finance tests: a pretend ЮKassa, a confirmed booking, and small database readers."""
from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta
from typing import Any

import asyncpg
import pytest

from app.config import get_settings
from tests.admin_world import publish_listing
from tests.live_helpers import Browser, sql, sql_value

SECRET = "live_test_secret_key_value"
MONDAY = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)


class FakeProvider:
    """Stands in for ЮKassa: remembers what it was asked and lets a test decide how each payment / refund ends."""

    def __init__(self) -> None:
        self.created: list[dict] = []
        self.payments: dict[str, dict] = {}
        self.refunds: dict[str, dict] = {}
        self.refund_requests: list[dict] = []
        self.fail_next: Exception | None = None
        self.fail_refund_next: Exception | None = None
        self.unreachable = False

    # -- payments
    async def create_payment(self, *, amount_kopecks, currency, description, return_url, idempotence_key, metadata, receipt=None):
        from app.integrations.yookassa import YooKassaError

        if self.unreachable:
            raise YooKassaError("ЮKassa is unreachable", retryable=True)
        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error
        existing = next((p for p in self.payments.values() if p["_key"] == idempotence_key), None)
        if existing is not None:  # idempotent, like the real thing
            return self._public(existing)
        pid = f"2f{len(self.payments):06d}-000f-5000-9000-1a2b3c4d5e6f"
        payment = {
            "id": pid, "status": "pending", "paid": False, "amount": {"value": f"{amount_kopecks // 100}.{amount_kopecks % 100:02d}", "currency": currency},
            "confirmation": {"type": "redirect", "confirmation_url": f"https://yoomoney.ru/checkout/payments/v2/contract?orderId={pid}"},
            "metadata": dict(metadata), "_key": idempotence_key,
        }
        self.payments[pid] = payment
        self.created.append({"amount_kopecks": amount_kopecks, "currency": currency, "description": description, "return_url": return_url,
                             "idempotence_key": idempotence_key, "metadata": metadata, "receipt": receipt})
        return self._public(payment)

    async def get_payment(self, provider_payment_id):
        from app.integrations.yookassa import YooKassaError

        if self.unreachable:
            raise YooKassaError("ЮKassa is unreachable", retryable=True)
        if provider_payment_id not in self.payments:
            raise YooKassaError("ЮKassa answered 404 not_found", status_code=404)
        return self._public(self.payments[provider_payment_id])

    @staticmethod
    def _public(payment: dict) -> dict:
        return {k: v for k, v in payment.items() if k != "_key"}

    def finish(self, pid: str, status: str, **changes) -> None:
        self.payments[pid].update({"status": status, "paid": status == "succeeded", **changes})

    # -- refunds
    async def create_refund(self, *, provider_payment_id, amount_kopecks, currency, description, idempotence_key, receipt=None):
        if self.fail_refund_next is not None:
            error, self.fail_refund_next = self.fail_refund_next, None
            raise error
        existing = next((r for r in self.refunds.values() if r["_key"] == idempotence_key), None)
        if existing is not None:
            return self._public(existing)
        rid = f"3a{len(self.refunds):06d}-000f-5000-8000-1a2b3c4d5e6f"
        refund = {"id": rid, "payment_id": provider_payment_id, "status": "pending", "amount": {"value": f"{amount_kopecks // 100}.{amount_kopecks % 100:02d}", "currency": currency}, "_key": idempotence_key}
        self.refunds[rid] = refund
        self.refund_requests.append({"payment_id": provider_payment_id, "amount_kopecks": amount_kopecks, "idempotence_key": idempotence_key, "receipt": receipt})
        return self._public(refund)

    async def get_refund(self, provider_refund_id):
        return self._public(self.refunds[provider_refund_id])

    def finish_refund(self, rid: str, status: str = "succeeded", **changes) -> None:
        self.refunds[rid].update({"status": status, **changes})


def enable_payments(monkeypatch, provider: FakeProvider, **extra: str) -> None:
    monkeypatch.setenv("YOOKASSA_ENABLED", "true")
    monkeypatch.setenv("YOOKASSA_SHOP_ID", "123456")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", SECRET)
    monkeypatch.setenv("YOOKASSA_WEBHOOK_IP_CHECK", "false")
    for key, value in extra.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    monkeypatch.setattr("app.services.payments.get_client", lambda settings: provider)
    monkeypatch.setattr("app.services.refunds.get_client", lambda settings: provider)


def confirmed_booking(world, *, coach_email="coach@example.com", player_email="player@example.com", title="Теннис для взрослых", confirm=False):
    coach = Browser(world.client, coach_email, "Тренер", "coach")
    listing = publish_listing(coach, title)
    player = Browser(world.client, player_email, "Игрок", "player")
    player.ok("PUT", "/api/profile/player", json={"full_name": "Игорь", "sport": "Теннис", "age": 20, "height_cm": None, "weight_kg": None,
                                                  "position": None, "level": "amateur", "goals": None, "load_restrictions": None})
    slots = player.ok("GET", f"/api/coach-listings/{listing['id']}/slots", params={"from_date": MONDAY.isoformat(), "to_date": MONDAY.isoformat()})
    booking = player.ok("POST", "/api/bookings", json={"listing_id": listing["id"], "starts_at": slots[0]["starts_at"], "format": "online"})
    if confirm:
        coach.ok("POST", f"/api/bookings/{booking['id']}/confirm")
    return coach, player, booking


def webhook(world, provider_id: str, event: str = "payment.succeeded"):
    world.client.cookies.clear()
    return world.client.post("/api/payments/yookassa/webhook", json={"type": "notification", "event": event, "object": {"id": provider_id, "status": "succeeded"}})


def run(coro):
    return asyncio.run(coro)


async def with_conn(dsn: str, fn):
    conn = await asyncpg.connect(dsn)
    try:
        return await fn(conn)
    finally:
        await conn.close()


def ledger_totals(dsn: str) -> dict[str, int]:
    from app.repositories.ledger import ACCOUNT_SPECS

    rows = sql(dsn, "SELECT code, COALESCE(SUM(balance_kopecks), 0) AS total FROM ledger_accounts GROUP BY code")
    totals = {code: 0 for code in ACCOUNT_SPECS}
    totals.update({r["code"]: int(r["total"]) for r in rows})
    return totals


def trainer_balances(dsn: str, coach_id: str) -> dict[str, int]:
    rows = sql(dsn, "SELECT code, balance_kopecks FROM ledger_accounts WHERE owner_user_id = $1::uuid", coach_id)
    return {r["code"]: int(r["balance_kopecks"]) for r in rows}


def assert_books_are_sound(dsn: str) -> None:
    """The ledger invariants that must hold after ANY scenario."""
    assert sql_value(dsn, "SELECT COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'debit'), 0) = COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'credit'), 0) FROM ledger_entries")
    mismatches = sql(dsn, """
        SELECT a.code FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id
        HAVING a.balance_kopecks <> COALESCE(SUM(CASE WHEN e.direction = a.normal_side THEN e.amount_kopecks ELSE -e.amount_kopecks END), 0)""")
    assert mismatches == []
    t = ledger_totals(dsn)
    owed = t["trainer_pending"] + t["trainer_available"] + t["trainer_reserved"]
    assert t["provider_receivable"] + t["trainer_debt"] == owed + t["platform_revenue"] + t["payouts_external"]
