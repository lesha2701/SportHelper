"""Reconciliation: closing the gaps a webhook can leave (late, lost, or arriving while we were down).

Bounded on purpose: only UNFINISHED attempts/refunds, young enough to matter, a limited batch per tick, an exponential pause between
asks about the same object - never a loop over all payments."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError
from app.repositories import bookings as bookings_repo
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.repositories import users as users_repo
from app.services import earnings as earnings_service
from app.services import payments as payments_service
from app.services import refunds as refunds_service

logger = logging.getLogger("teamflow.payments")


async def reconcile_payments(conn: asyncpg.Connection, settings: Settings) -> dict[str, int]:
    stats = {"checked": 0, "resent": 0, "errors": 0, "expired": 0}
    if not settings.payments_configured:  # with new payments switched off it still closes what is already in flight
        return stats
    stats["expired"] = await payments_repo.expire_old_attempts(conn, max_age_hours=settings.reconcile_max_age_hours)
    for attempt in await payments_repo.attempts_to_reconcile(conn, max_age_hours=settings.reconcile_max_age_hours, limit=settings.reconcile_batch_size):
        await payments_repo.touch_checked(conn, attempt["id"])  # a failure must not make the same attempt first in line forever
        stats["checked"] += 1
        try:
            if attempt["provider_payment_id"] is None:
                await _retry_creation(conn, settings, attempt)
                stats["resent"] += 1
            else:
                await payments_service.sync_attempt(conn, settings, attempt, source="reconcile")
        except (YooKassaError, APIError) as exc:
            stats["errors"] += 1
            logger.warning("Reconciliation of attempt %s failed: %s", attempt["id"], exc)
    for refund in await refunds_repo.list_unfinished(conn, limit=settings.reconcile_batch_size):
        try:
            await refunds_service.sync_refund(conn, settings, refund, source="reconcile")
            stats["checked"] += 1
        except (YooKassaError, APIError) as exc:
            stats["errors"] += 1
            logger.warning("Reconciliation of refund %s failed: %s", refund["id"], exc)
    return stats


async def _retry_creation(conn: asyncpg.Connection, settings: Settings, attempt: dict) -> None:
    """The first call to ЮKassa got no answer (we do not know whether it created the payment). Repeating it with the SAME
    Idempotence-Key returns the same payment if it exists - but only while the provider still honours the key."""
    payment = await payments_repo.get_payment(conn, attempt["payment_id"])
    assert payment is not None
    if datetime.now(timezone.utc) - attempt["created_at"] > payments_service.IDEMPOTENCE_WINDOW:
        await payments_repo.mark_attempt_canceled(conn, attempt["id"], "unknown_outcome", status="expired")
        if await payments_repo.record_incident(conn, kind="reconcile_gap", payment_id=payment["id"], attempt_id=attempt["id"],
                                              detail="a payment request got no answer and could not be re-sent safely: check the ЮKassa cabinet"):
            from app.services import finance_notifications as notify

            await notify.incident(conn, settings, kind="reconcile_gap", payment_id=payment["id"], key=str(attempt["id"]))
        return
    booking = await bookings_repo.get_booking(conn, payment["booking_id"])
    user = await users_repo.get_by_id(conn, payment["payer_user_id"])
    if booking is None or user is None:
        return
    await payments_service._create_at_provider(conn, settings, booking=booking, user=user, payment=payment, attempt=attempt)


async def run_finance_tick(conn: asyncpg.Connection, settings: Settings) -> None:
    """Everything the background loop does for the finance contour (each part isolated: one failure never blocks the rest)."""
    for name, job in (("payments", reconcile_payments), ("earnings", earnings_service.release_due_earnings)):
        try:
            await job(conn, settings)
        except Exception:  # noqa: BLE001 - a bad step must not stop the others
            logger.exception("Finance background step %r failed", name)
