"""Paying for a confirmed booking through ЮKassa, and learning what really happened.

The rules, in one place:
  * only the athlete of a CONFIRMED booking, only while the session has not ended or been cancelled, only for the price stored on
    the booking (never an amount sent by the browser);
  * one payment obligation per booking, whose amounts (price, commission, the trainer's share) are frozen when it is created;
    each try is a separate attempt, at most one open and at most one successful per payment (database indexes);
  * the outcome of an attempt is learned ONLY by reading it back from ЮKassa with our credentials: a webhook body, the customer's
    return to the site and any id in a request are just hints. A success is accepted only if id, amount, currency and the booking
    all match what we asked for;
  * accepting a success is ONE database transaction: attempt -> succeeded, payment -> paid, the trainer's earning, the ledger
    posting and the notifications. Replays (webhook twice, webhook + refresh + reconciliation) change nothing the second time;
  * a second real charge for the same payment is recorded as an incident, never as a second success;
  * no database transaction is held open during a call to ЮKassa.
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError, get_client
from app.repositories import bookings as bookings_repo
from app.repositories import earnings as earnings_repo
from app.repositories import ledger
from app.repositories import legal as legal_repo
from app.repositories import payments as payments_repo
from app.repositories.ledger import Leg
from app.services import finance_notifications as notify
from app.services.legal import DOCUMENTS
from app.services.money import rub_to_kopecks, split_commission

logger = logging.getLogger("teamflow.payments")

SUPPORTED_CURRENCIES = {"RUB"}
STANDARD_TERMS_KEY = "service-terms"
# ЮKassa's published source addresses for HTTP notifications (https://yookassa.ru/developers/using-api/webhooks).
YOOKASSA_NETWORKS = [
    ipaddress.ip_network(n) for n in ("185.71.76.0/27", "185.71.77.0/27", "77.75.153.0/25", "77.75.156.11/32", "77.75.156.35/32", "77.75.154.128/25", "2a02:5180::/32")
]
# An attempt whose creation call may have reached ЮKassa can be re-sent with the same Idempotence-Key for a day.
IDEMPOTENCE_WINDOW = timedelta(hours=23)


def ip_is_from_yookassa(address: "str | ipaddress.IPv4Address | ipaddress.IPv6Address | None") -> bool:
    if address is None:
        return False
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in network for network in YOOKASSA_NETWORKS)


def payment_status_of(booking: dict[str, Any], summary: dict[str, Any] | None) -> str:
    """What the screens show: not_required (free), unpaid, processing (a payment page is open), paid, canceled (the last try ended
    without payment), refund_pending, refunded."""
    price = booking.get("price_per_session")
    if not price or price <= 0:
        return "not_required"
    if summary is None:
        return "unpaid"
    status = summary["status"]
    if status == "refunded":
        return "refunded"
    if status in ("paid", "partially_refunded"):
        return "refund_pending" if summary["refund_reserved_kopecks"] > summary["refunded_kopecks"] else "paid"
    if summary.get("has_open_page"):
        return "processing"
    if summary.get("last_attempt_status") in ("canceled", "expired"):
        return "canceled"
    return "unpaid"


def ensure_payable(booking: dict[str, Any], *, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if booking["status"] != "confirmed":
        raise APIError("Оплатить можно только подтверждённую тренером запись.", code="booking_not_confirmed", status_code=409)
    ends_at = booking["starts_at"] + timedelta(minutes=booking["duration_minutes"] or 0)
    if booking.get("training_status") in ("cancelled", "completed") or ends_at <= now:
        raise APIError("Эта тренировка уже закрыта — оплатить её нельзя.", code="booking_closed", status_code=409)
    price = booking.get("price_per_session")
    if not price or price <= 0:
        raise APIError("За эту тренировку платить не нужно.", code="nothing_to_pay", status_code=409)
    if booking["currency"] not in SUPPORTED_CURRENCIES:
        raise APIError("Эта валюта не поддерживается для оплаты.", code="currency_not_supported", status_code=409)


def _return_url(settings: Settings, booking_id: Any) -> str:
    return f"{settings.payment_return_url}?booking={booking_id}"


def _receipt(settings: Settings, booking: dict[str, Any], user: dict[str, Any], gross_kopecks: int) -> dict[str, Any] | None:
    if not settings.yookassa_send_receipt:
        return None
    if not user.get("email"):
        # Fiscalisation is on: paying without a receipt address would be a tax problem, so refuse instead of quietly skipping it.
        raise APIError("Для чека нужен адрес электронной почты в профиле.", code="receipt_email_required", status_code=422)
    value = f"{gross_kopecks // 100}.{gross_kopecks % 100:02d}"
    return {
        "customer": {"email": user["email"]},
        "items": [{
            "description": (booking.get("listing_title") or "Тренировка")[:128], "quantity": "1.00",
            "amount": {"value": value, "currency": booking["currency"]}, "vat_code": settings.yookassa_vat_code,
            "payment_subject": "service", "payment_mode": "full_payment",
        }],
    }


def _description(booking: dict[str, Any]) -> str:
    return f"Тренировка «{booking.get('listing_title') or 'с тренером'}», {booking['starts_at'].strftime('%d.%m.%Y %H:%M')} (UTC)"


# --- starting a payment ----------------------------------------------------------------------------------------------------


async def start_payment(
    conn: asyncpg.Connection, settings: Settings, *, booking: dict[str, Any], user: dict[str, Any], ip: str | None, _again: bool = False
) -> dict[str, Any]:
    """Returns the attempt (with `confirmation_url`) the customer should be sent to: the open one, or a fresh one."""
    if not settings.payments_enabled:
        raise APIError("Онлайн-оплата сейчас недоступна.", code="payments_unavailable", status_code=503)
    ensure_payable(booking)
    gross = rub_to_kopecks(booking["price_per_session"])  # from the booking row, never from the request
    fee, trainer = split_commission(gross, settings.platform_commission_percent)

    async with conn.transaction():
        # Serialises two simultaneous clicks on the same booking.
        await conn.execute("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", booking["id"])
        payment, created = await payments_repo.create_payment(
            conn, booking_id=booking["id"], payer_user_id=user["id"], coach_user_id=booking["coach_user_id"], currency=booking["currency"],
            gross_kopecks=gross, commission_percent=settings.platform_commission_percent, platform_fee_kopecks=fee, trainer_kopecks=trainer,
        )
        if payment["payer_user_id"] != user["id"]:
            raise APIError("Это бронирование оплачивает другой пользователь.", code="payment_owner_mismatch", status_code=409)
        if created:
            terms = DOCUMENTS[STANDARD_TERMS_KEY]
            await legal_repo.record(
                conn, user_id=user["id"], role=user.get("preferred_role") or "player",
                full_name=" ".join(p for p in (user.get("first_name"), user.get("last_name")) if p), phone=None,
                email=user.get("email") or "", consent_key="service_terms_payment",
                documents=[{"key": terms.key, "title": terms.title, "version": terms.version}], ip_address=ip, booking_id=booking["id"],
            )
        if payment["status"] != "awaiting":
            raise APIError("Эта тренировка уже оплачена.", code="already_paid", status_code=409)
        attempt = await payments_repo.get_open_attempt(conn, payment["id"], lock=True)
        if attempt is None:
            attempt = await payments_repo.insert_attempt(conn, payment["id"])

    if attempt["provider_payment_id"] is None:
        return await _create_at_provider(conn, settings, booking=booking, user=user, payment=payment, attempt=attempt)

    # A payment page already exists: is it still alive (the customer may have paid, or let it expire)?
    attempt = await sync_attempt(conn, settings, attempt)
    fresh = await payments_repo.get_payment(conn, payment["id"])
    if fresh and fresh["status"] != "awaiting":
        raise APIError("Эта тренировка уже оплачена.", code="already_paid", status_code=409)
    if attempt["status"] in ("canceled", "expired") and not _again:
        return await start_payment(conn, settings, booking=booking, user=user, ip=ip, _again=True)  # a fresh attempt
    return attempt


async def _create_at_provider(
    conn: asyncpg.Connection, settings: Settings, *, booking: dict[str, Any], user: dict[str, Any], payment: dict[str, Any], attempt: dict[str, Any]
) -> dict[str, Any]:
    try:
        data = await get_client(settings).create_payment(
            amount_kopecks=payment["gross_kopecks"], currency=payment["currency"], description=_description(booking),
            return_url=_return_url(settings, booking["id"]), idempotence_key=str(attempt["idempotence_key"]),
            metadata={"booking_id": str(booking["id"]), "payment_id": str(payment["id"]), "attempt_id": str(attempt["id"])},
            receipt=_receipt(settings, booking, user, payment["gross_kopecks"]),
        )
        url = (data.get("confirmation") or {}).get("confirmation_url")
        provider_id = data.get("id")
        if not isinstance(provider_id, str) or not isinstance(url, str) or not url.startswith("https://"):
            raise YooKassaError("ЮKassa answered without a payment page")
    except YooKassaError as exc:
        logger.warning("Could not start a payment for booking %s: %s", booking["id"], exc)
        if not exc.retryable:
            # The provider will never accept this request: free the booking for another attempt.
            await payments_repo.mark_attempt_canceled(conn, attempt["id"], "provider_rejected")
        # (A retryable failure keeps the attempt: the same Idempotence-Key makes the next try safe, and reconciliation finishes it.)
        raise APIError(
            "Не удалось открыть страницу оплаты. Попробуйте ещё раз через минуту.", code="payment_provider_error", status_code=502
        ) from exc
    await payments_repo.attach_provider_payment(conn, attempt["id"], provider_payment_id=provider_id, confirmation_url=url)
    return {**attempt, "provider_payment_id": provider_id, "confirmation_url": url, "status": "pending"}


# --- learning the outcome --------------------------------------------------------------------------------------------------


def _provider_matches(payment: dict[str, Any], attempt: dict[str, Any], data: dict[str, Any]) -> str | None:
    """None when the provider's object is exactly what we asked for; otherwise what differs (for the incident record)."""
    try:
        amount = data["amount"]
        if data.get("id") != attempt["provider_payment_id"]:
            return "payment id differs"
        if data.get("paid") is not True:
            return "payment is not marked paid"
        if amount["currency"] != payment["currency"]:
            return f"currency {amount['currency']} instead of {payment['currency']}"
        if rub_to_kopecks(str(amount["value"])) != payment["gross_kopecks"]:
            return f"amount {amount['value']} differs from the {payment['gross_kopecks']} kopecks requested"
        metadata = data.get("metadata") or {}
        if metadata.get("booking_id") not in (None, str(payment["booking_id"])):
            return "payment belongs to another booking"
    except (KeyError, TypeError, ValueError):
        return "unreadable payment object"
    return None


async def sync_attempt(conn: asyncpg.Connection, settings: Settings, attempt: dict[str, Any], *, source: str = "api") -> dict[str, Any]:
    """Reads the attempt back from ЮKassa and applies the outcome. Safe to call any number of times from anywhere."""
    if attempt["status"] not in ("created", "pending", "expired") or not attempt["provider_payment_id"] or not settings.payments_configured:
        return attempt
    data = await get_client(settings).get_payment(attempt["provider_payment_id"])
    status = data.get("status")
    payment = await payments_repo.get_payment(conn, attempt["payment_id"])
    assert payment is not None
    if status == "succeeded":
        problem = _provider_matches(payment, attempt, data)
        if problem is not None:
            logger.error("Payment attempt %s: success does not match the request (%s) - NOT applied", attempt["id"], problem)
            if await payments_repo.record_incident(conn, kind="amount_mismatch", payment_id=payment["id"], attempt_id=attempt["id"], detail=problem):
                await notify.incident(conn, settings, kind="amount_mismatch", payment_id=payment["id"], key=str(attempt["id"]))
            await payments_repo.record_event(conn, source=source, event="payment.succeeded", provider_object_id=attempt["provider_payment_id"], outcome="mismatch", detail=problem)
        else:
            await _finalize_success(conn, settings, attempt["id"])
            await payments_repo.record_event(conn, source=source, event="payment.succeeded", provider_object_id=attempt["provider_payment_id"], outcome="applied")
    elif status == "canceled":
        reason = (data.get("cancellation_details") or {}).get("reason")
        await _finalize_canceled(conn, payment, attempt, reason if isinstance(reason, str) else None)
        await payments_repo.record_event(conn, source=source, event="payment.canceled", provider_object_id=attempt["provider_payment_id"], outcome="applied", detail=reason if isinstance(reason, str) else None)
    else:
        await payments_repo.touch_checked(conn, attempt["id"])
    return await payments_repo.get_attempt(conn, attempt["id"]) or attempt


async def _finalize_canceled(conn: asyncpg.Connection, payment: dict[str, Any], attempt: dict[str, Any], reason: str | None) -> None:
    async with conn.transaction():
        if await payments_repo.mark_attempt_canceled(conn, attempt["id"], reason):
            await notify.payment_canceled(conn, payment, attempt["id"])


async def _finalize_success(conn: asyncpg.Connection, settings: Settings, attempt_id: UUID) -> None:
    async with conn.transaction():
        attempt = await payments_repo.get_attempt(conn, attempt_id)
        assert attempt is not None
        payment = await payments_repo.get_payment(conn, attempt["payment_id"], lock=True)
        assert payment is not None
        outcome = await payments_repo.mark_attempt_succeeded(conn, attempt_id)
        if outcome in ("already", "ignored"):
            return
        if outcome == "duplicate":
            # A second REAL charge for a payment that was already paid: never a second accounting success. Recorded, and a
            # finance administrator decides on the refund (see refunds).
            if await payments_repo.record_incident(conn, kind="duplicate_payment", payment_id=payment["id"], attempt_id=attempt_id,
                                                  detail="a second attempt of an already paid payment succeeded at the provider: refund required"):
                await notify.incident(conn, settings, kind="duplicate_payment", payment_id=payment["id"], key=str(attempt_id))
            return
        if not await payments_repo.mark_payment_paid(conn, payment["id"]):
            if await payments_repo.record_incident(conn, kind="paid_unexpected_state", payment_id=payment["id"], attempt_id=attempt_id,
                                                  detail=f"a payment in state {payment['status']} received money"):
                await notify.incident(conn, settings, kind="paid_unexpected_state", payment_id=payment["id"], key=str(attempt_id))
            return
        booking = await bookings_repo.get_booking(conn, payment["booking_id"])
        completed = bool(booking and booking.get("training_status") == "completed")
        earning, _ = await earnings_repo.create(conn, payment, session_confirmed=completed)
        await ledger.post(
            conn, kind="payment_received", business_key=f"payment:{payment['id']}:received",
            description="Оплата тренировки получена", payment_id=payment["id"], booking_id=payment["booking_id"], earning_id=earning["id"],
            legs=[
                Leg("provider_receivable", "debit", payment["gross_kopecks"]),
                Leg("trainer_pending", "credit", payment["trainer_kopecks"], owner=payment["coach_user_id"]),
                Leg("platform_revenue", "credit", payment["platform_fee_kopecks"]),
            ] if payment["platform_fee_kopecks"] > 0 else [
                Leg("provider_receivable", "debit", payment["gross_kopecks"]),
                Leg("trainer_pending", "credit", payment["trainer_kopecks"], owner=payment["coach_user_id"]),
            ],
        )
        await notify.payment_confirmed(conn, payment)
        if booking is None or booking["status"] != "confirmed" or booking.get("training_status") == "cancelled":
            if await payments_repo.record_incident(conn, kind="paid_booking_closed", payment_id=payment["id"], attempt_id=attempt_id,
                                                  detail="the payment succeeded for a booking that is no longer active: decide on a refund"):
                await notify.incident(conn, settings, kind="paid_booking_closed", payment_id=payment["id"], key=str(attempt_id))


# --- what the booking screens call -------------------------------------------------------------------------------------------


async def refresh_booking_payment(conn: asyncpg.Connection, settings: Settings, booking_id: UUID) -> None:
    """The customer is back (or reopened the bookings): ask ЮKassa about an unfinished attempt."""
    payment = await payments_repo.get_for_booking(conn, booking_id)
    if payment is None or payment["status"] != "awaiting":
        return
    attempt = await payments_repo.get_open_attempt(conn, payment["id"])
    if attempt is not None:
        await sync_attempt(conn, settings, attempt, source="return")
