"""The money history of one booking: the payment and every refund, as the athlete and the trainer of the booking may see it.

Both sides see the price, the payment and the refunds with their amounts and states. The trainer also sees their own share and the
platform's commission (the athlete has no use for that split). The reason of a refund is shown only where it is the cancellation's own
reason: an administrator's internal note about a refund never leaves the administration."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.core.exceptions import NotFoundError
from app.repositories import booking_cancellations as cancellations_repo
from app.repositories import bookings as bookings_repo
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.services.cancellations import ATHLETE, COACH, role_of

_PAID = ("paid", "partially_refunded", "refunded")


def refund_state(refund: dict[str, Any]) -> str:
    """pending (requested or waiting for the bank) | succeeded | failed."""
    return {"succeeded": "succeeded", "failed": "failed"}.get(refund["status"], "pending")


async def history(conn: asyncpg.Connection, booking_id: UUID, user_id: UUID) -> dict[str, Any]:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    role = role_of(booking, user_id)  # someone else's booking looks exactly like a missing one
    payment = await payments_repo.get_for_booking(conn, booking_id)
    cancellation = await cancellations_repo.get_for_booking(conn, booking_id)

    refunds: list[dict[str, Any]] = []
    if payment is not None:
        for refund in await refunds_repo.list_for_payment(conn, payment["id"]):
            if refund["kind"] != "payment":
                continue  # a duplicate charge is an incident for the administrator, not a part of this booking's story
            by_cancellation = cancellation is not None and cancellation["refund_id"] == refund["id"]
            if by_cancellation:
                source = "cancellation"
            elif refund["requested_by"] == payment["payer_user_id"]:
                source = "automatic"  # the payment that arrived after the booking was cancelled, returned by itself
            else:
                source = "administrator"
            item = {
                "id": refund["id"], "amount_kopecks": refund["amount_kopecks"], "status": refund_state(refund), "source": source,
                "reason": cancellation["reason"] if by_cancellation else None,
                "created_at": refund["created_at"], "completed_at": refund["completed_at"],
            }
            if role == COACH:
                item["trainer_refund_kopecks"] = refund["trainer_refund_kopecks"]
            refunds.append(item)

    paid_in = payment is not None and payment["status"] in _PAID
    result: dict[str, Any] = {
        "booking_id": booking_id,
        "viewer_role": role,
        "currency": payment["currency"] if payment else booking["currency"],
        "payment": None,
        "refunds": refunds,
        "refunded_kopecks": sum(r["amount_kopecks"] for r in refunds if r["status"] == "succeeded"),
        "cancelled_at": cancellation["created_at"] if cancellation else None,
        "cancellation_policy": cancellation["policy"] if cancellation else None,
    }
    if payment is not None:
        result["payment"] = {
            "status": payment["status"], "gross_kopecks": payment["gross_kopecks"], "paid_at": payment["paid_at"] if paid_in else None,
        }
        if role == COACH:
            result["payment"].update(trainer_kopecks=payment["trainer_kopecks"], platform_fee_kopecks=payment["platform_fee_kopecks"])
    return result


__all__ = ["history", "ATHLETE", "COACH"]
