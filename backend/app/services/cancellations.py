"""Cancelling a confirmed booking and what happens to the money (docs/refunds-api.md has the contract and the agreed rules).

The rule, decided on 10.11.2026:
- the trainer cancels (a reason is required): the athlete gets everything back;
- the athlete cancels at least CANCEL_FREE_HOURS before the start: everything back; later: nothing, the trainer keeps the payment;
- nothing was paid: nothing to return.

Everything that must stay true together is done in one transaction with the booking and the payment locked: the booking is cancelled, its session
is cancelled, the history row is written, the refund is reserved in the payment, the trainer's earning is settled. Sending the refund to ЮKassa
comes after the commit and can never stop the cancellation: an unsent refund waits in the queue and the reconciliation sends it again."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.repositories import booking_cancellations as cancellations_repo
from app.repositories import bookings as bookings_repo
from app.repositories import earnings as earnings_repo
from app.repositories import notifications as notifications_repo
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.repositories import trainings as trainings_repo
from app.services import notifications as notifications_service
from app.services import refunds as refunds_service

logger = logging.getLogger("teamflow.payments")

ATHLETE = "athlete"
COACH = "coach"
MIN_COACH_REASON = 3


@dataclass(frozen=True)
class Plan:
    """What cancelling a booking right now means. Computed the same way for the preview and for the real thing."""

    role: str
    policy: str  # unpaid | athlete_early | athlete_late | coach
    hours_before_start: Decimal
    free_cancel_until: datetime | None
    paid_kopecks: int
    refund_percent: int
    refund_kopecks: int

    @property
    def trainer_keeps_payment(self) -> bool:
        return self.policy == "athlete_late"


def role_of(booking: dict[str, Any], user_id: UUID) -> str:
    """The caller's side of the booking. Someone else's booking looks exactly like a missing one."""
    if booking["coach_user_id"] == user_id:
        return COACH
    if booking["athlete_user_id"] == user_id:
        return ATHLETE
    raise NotFoundError("booking not found")


def check_cancellable(booking: dict[str, Any], *, now: datetime) -> None:
    if booking["status"] != "confirmed":
        raise APIError("Отменить можно только подтверждённую тренером запись.", code="booking_not_confirmed", status_code=409)
    if booking.get("training_status") == "completed":
        raise APIError("Это занятие уже проведено — отменить его нельзя.", code="session_completed", status_code=409)
    if booking.get("training_status") == "cancelled":
        raise APIError("Это занятие уже отменено.", code="session_cancelled", status_code=409)
    if booking["starts_at"] <= now:
        raise APIError("Занятие уже началось — отменить его нельзя.", code="session_started", status_code=409)


def make_plan(booking: dict[str, Any], payment: dict[str, Any] | None, role: str, *, now: datetime, settings: Settings) -> Plan:
    hours = Decimal((booking["starts_at"] - now).total_seconds() / 3600).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    paid = payment is not None and payment["status"] in ("paid", "partially_refunded", "refunded")
    if not paid:
        return Plan(role, "unpaid", hours, None, 0, 0, 0)
    assert payment is not None
    free_until = booking["starts_at"] - timedelta(hours=settings.cancel_free_hours)
    if role == COACH:
        policy, percent = "coach", 100
    elif now <= free_until:
        policy, percent = "athlete_early", 100
    else:
        policy, percent = "athlete_late", 0
    gross = payment["gross_kopecks"]
    room = gross - payment["refund_reserved_kopecks"]  # what an earlier (administrator's) refund has not already taken
    amount = min(room, gross * percent // 100) if percent > 0 else 0
    if amount < refunds_service.MIN_REFUND_KOPECKS:
        amount = 0  # ЮKassa does not return less than 1 RUB
    # the percent is of what is really returned: after a part was already refunded by an administrator, «everything» is only what is left
    actual = max(1, min(100, (amount * 100 + gross // 2) // gross)) if amount > 0 else 0
    return Plan(role, policy, hours, free_until if role == ATHLETE else None, gross, actual, amount)


async def preview(conn: asyncpg.Connection, settings: Settings, booking_id: UUID, user: dict[str, Any]) -> tuple[dict[str, Any], Plan]:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    role = role_of(booking, user["id"])
    now = datetime.now(timezone.utc)
    check_cancellable(booking, now=now)
    payment = await payments_repo.get_for_booking(conn, booking_id)
    return booking, make_plan(booking, payment, role, now=now, settings=settings)


async def cancel(
    conn: asyncpg.Connection, settings: Settings, *, booking_id: UUID, user: dict[str, Any], reason: str | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Cancels the booking for the caller. Returns the booking and its cancellation row; repeating the call changes nothing."""
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    role = role_of(booking, user["id"])
    reason = (reason or "").strip() or None
    refund: dict[str, Any] | None = None
    async with conn.transaction():
        await bookings_repo.lock_booking(conn, booking_id)
        booking = await bookings_repo.get_booking(conn, booking_id) or booking  # as it is now, after anyone who held the lock before us
        existing = await cancellations_repo.get_for_booking(conn, booking_id)
        if existing is not None:
            return booking, existing
        now = datetime.now(timezone.utc)
        check_cancellable(booking, now=now)
        if role == COACH and (reason is None or len(reason) < MIN_COACH_REASON):
            raise APIError("Укажите причину отмены.", code="reason_required", status_code=422)
        payment = await payments_repo.get_for_booking(conn, booking_id, lock=True)
        plan = make_plan(booking, payment, role, now=now, settings=settings)

        row = await cancellations_repo.insert(
            conn, booking_id=booking_id, cancelled_by=user["id"], cancelled_by_role=role, reason=reason, session_starts_at=booking["starts_at"],
            hours_before_start=plan.hours_before_start, policy=plan.policy, paid_kopecks=plan.paid_kopecks,
            refund_percent=plan.refund_percent, refund_kopecks=plan.refund_kopecks,
        )
        if row is None or not await bookings_repo.mark_cancelled(conn, booking_id):
            raise APIError("Запись уже отменена.", code="session_cancelled", status_code=409)
        if booking["training_id"] is not None:
            await trainings_repo.update_training(conn, booking["training_id"], status="cancelled")
            await notifications_repo.cancel_pending_for_entity(conn, "training", booking["training_id"])
        if plan.trainer_keeps_payment:
            # The trainer keeps this payment although the session did not happen, so it goes the normal way to release (the hold, then the release).
            await earnings_repo.confirm_session(conn, booking_id)
        if plan.refund_kopecks > 0:
            assert payment is not None
            refund = await refunds_service.reserve_payment_refund(
                conn, settings, payment, amount_kopecks=plan.refund_kopecks, requested_by=user["id"],
                reason="Отмена записи тренером" if role == COACH else "Отмена записи игроком",
            )
            await cancellations_repo.attach_refund(conn, booking_id, refund["id"])
        await notifications_service.schedule_booking_cancelled_notification(
            conn, booking, by_role=role, refund_percent=plan.refund_percent, paid=plan.paid_kopecks > 0
        )
    if refund is not None:
        await refunds_service.dispatch_reserved_refund(conn, settings, refund)
    updated = await bookings_repo.get_booking(conn, booking_id)
    saved = await cancellations_repo.get_for_booking(conn, booking_id)
    assert updated is not None and saved is not None
    return updated, saved


def refund_status_of(refund: dict[str, Any] | None) -> str:
    """none | pending | succeeded | failed: what the screens show about the money of a cancellation."""
    if refund is None:
        return "none"
    return {"succeeded": "succeeded", "failed": "failed"}.get(refund["status"], "pending")


async def refund_of(conn: asyncpg.Connection, cancellation: dict[str, Any]) -> dict[str, Any] | None:
    if cancellation["refund_id"] is None:
        return None
    return await refunds_repo.get(conn, cancellation["refund_id"])
