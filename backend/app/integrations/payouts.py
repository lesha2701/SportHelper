"""The payout provider: whatever actually moves money to a trainer (a bank API, ЮKassa payouts, ...).

The system talks to it only through this narrow interface, so the rules around it (limits, checks, idempotency, reconciliation) do not
depend on which bank is chosen. Two properties are required of ANY real implementation, and the service relies on them:
  * `send` is idempotent on `idempotency_key`: the same key never creates a second operation;
  * `status` finds an operation by that same key (so an unanswered `send` can be looked up instead of repeated).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.config import Settings


@dataclass(frozen=True)
class PayoutOrder:
    idempotency_key: str
    amount_kopecks: int
    method: str                 # sbp | bank_transfer
    details: dict[str, str]     # the recipient's requisites, in memory only for the duration of the call
    description: str


@dataclass(frozen=True)
class PayoutResult:
    status: str                 # succeeded | pending | failed
    provider_payout_id: str | None
    amount_kopecks: int         # what the PROVIDER says it moved: compared with ours, never assumed
    fee_kopecks: int = 0
    error: str | None = None


class PayoutUnreachable(Exception):
    """No answer (a timeout, a broken connection). Nothing is known about whether the money moved."""


class PayoutProvider(Protocol):
    name: str

    async def send(self, order: PayoutOrder) -> PayoutResult: ...

    async def status(self, idempotency_key: str) -> PayoutResult | None:
        """None = the provider has no operation with that key."""

    async def statement(self, since: datetime) -> list[tuple[str, PayoutResult]]:
        """(idempotency_key, result) for every operation since the moment - what the daily reconciliation compares with our books."""


class FakeBank:
    """A pretend bank: remembers what it was asked, honours the idempotency key and lets a test (or the local dev stack) decide how the
    next operations end. Never used in production (config refuses it)."""

    name = "fake"

    def __init__(self) -> None:
        self.operations: dict[str, dict] = {}
        self.sent_orders: list[PayoutOrder] = []
        self.next_outcome = "succeeded"      # succeeded | pending | failed | unreachable | unreachable_but_done
        self.amount_delta = 0                # a lying bank: it reports a different amount than it was asked for

    def _result(self, op: dict) -> PayoutResult:
        return PayoutResult(op["status"], op["id"], op["amount"] + op["delta"], error=op.get("error"))

    async def send(self, order: PayoutOrder) -> PayoutResult:
        existing = self.operations.get(order.idempotency_key)
        if existing is not None:
            return self._result(existing)
        outcome, self.next_outcome = self.next_outcome, "succeeded"
        self.sent_orders.append(order)
        if outcome == "unreachable":
            raise PayoutUnreachable("the bank did not answer")
        status = {"succeeded": "succeeded", "unreachable_but_done": "succeeded", "pending": "pending", "failed": "failed"}[outcome]
        op = {"id": f"FAKE-{len(self.operations) + 1:06d}", "status": status, "amount": order.amount_kopecks, "delta": self.amount_delta,
              "error": "rejected by the bank" if status == "failed" else None, "at": datetime.now().astimezone()}
        self.operations[order.idempotency_key] = op
        if outcome == "unreachable_but_done":
            raise PayoutUnreachable("the bank did not answer, but it has done it")
        return self._result(op)

    async def status(self, idempotency_key: str) -> PayoutResult | None:
        op = self.operations.get(idempotency_key)
        return self._result(op) if op else None

    async def statement(self, since: datetime) -> list[tuple[str, PayoutResult]]:
        return [(key, self._result(op)) for key, op in self.operations.items() if op["at"] >= since]

    def finish(self, idempotency_key: str, status: str = "succeeded") -> None:
        self.operations[idempotency_key]["status"] = status


_fake_bank = FakeBank()


def get_provider(settings: Settings) -> PayoutProvider | None:
    """The configured provider, or None while payouts are manual."""
    if settings.payout_provider == "fake":
        return _fake_bank
    return None
