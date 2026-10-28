"""Paying for a confirmed booking through ЮKassa.

The rules, in one place:
  * only the athlete of a CONFIRMED booking, only while the session has not ended or been cancelled, only for the price
    stored on the booking (never an amount sent by the browser);
  * at most one live payment per booking (database index): a second click returns the same payment, a paid booking cannot
    be paid again;
  * the site learns a payment's outcome only by reading it back from ЮKassa (webhook bodies are just a nudge), and a result
    is accepted only if id, amount and currency match what we asked for;
  * ticking nothing but pressing "pay" is the acceptance of the standard terms: it is recorded (document + edition + booking).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError, get_client
from app.repositories import legal as legal_repo
from app.repositories import payments as payments_repo
from app.services.legal import DOCUMENTS

logger = logging.getLogger("teamflow.payments")

SUPPORTED_CURRENCIES = {"RUB"}
STANDARD_TERMS_KEY = "service-terms"


def payment_status_of(booking: dict[str, Any], summary: dict[str, Any] | None) -> str:
    """What the screens show: not_required (free), unpaid, pending (the customer has a live payment page) or paid."""
    price = booking.get("price_per_session")
    if not price or price <= 0:
        return "not_required"
    if summary and summary["status"] == "succeeded":
        return "paid"
    if summary and summary["status"] == "pending" and summary.get("has_provider"):
        return "pending"
    return "unpaid"


def _amount(booking: dict[str, Any]) -> Decimal:
    try:
        return Decimal(str(booking["price_per_session"])).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError) as exc:
        raise APIError("У тренировки не указана цена.", code="nothing_to_pay", status_code=409) from exc


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
    base = (settings.app_base_url or "").rstrip("/")
    # Lands on the athlete's bookings, on this very booking (the same deep link the "booking confirmed" notification uses).
    return f"{base}/?open=booking_decided&id={booking_id}"


def _receipt(settings: Settings, booking: dict[str, Any], user: dict[str, Any], amount: Decimal) -> dict[str, Any] | None:
    if not settings.yookassa_send_receipt or not user.get("email"):
        return None
    return {
        "customer": {"email": user["email"]},
        "items": [
            {
                "description": (booking.get("listing_title") or "Тренировка")[:128],
                "quantity": "1.00",
                "amount": {"value": f"{amount:.2f}", "currency": booking["currency"]},
                "vat_code": settings.yookassa_vat_code,
                "payment_subject": "service",
                "payment_mode": "full_payment",
            }
        ],
    }


def _description(booking: dict[str, Any]) -> str:
    when = booking["starts_at"].strftime("%d.%m.%Y %H:%M")
    return f"Тренировка «{booking.get('listing_title') or 'с тренером'}», {when} (UTC)"


async def start_payment(
    conn: asyncpg.Connection, settings: Settings, *, booking: dict[str, Any], user: dict[str, Any], ip: str | None
) -> dict[str, Any]:
    """Returns the payment the customer should be sent to (existing live one, or a new one)."""
    if not settings.payments_enabled:
        raise APIError("Онлайн-оплата сейчас недоступна.", code="payments_unavailable", status_code=503)
    ensure_payable(booking)
    amount = _amount(booking)

    async with conn.transaction():
        # Serialises two simultaneous clicks on the same booking.
        await conn.execute("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", booking["id"])
        live = await payments_repo.get_live_for_booking(conn, booking["id"], lock=True)
        if live is not None and live["status"] == "succeeded":
            raise APIError("Эта тренировка уже оплачена.", code="already_paid", status_code=409)
        if live is None:
            live = await payments_repo.insert_pending(
                conn, booking_id=booking["id"], payer_user_id=user["id"], amount=amount, currency=booking["currency"]
            )
            terms = DOCUMENTS[STANDARD_TERMS_KEY]
            await legal_repo.record(
                conn,
                user_id=user["id"],
                role=user.get("preferred_role") or "player",
                full_name=" ".join(p for p in (user.get("first_name"), user.get("last_name")) if p),
                phone=None,
                email=user.get("email") or "",
                consent_key="service_terms_payment",
                documents=[{"key": terms.key, "title": terms.title, "version": terms.version}],
                ip_address=ip,
                booking_id=booking["id"],
            )

    if live["provider_payment_id"] is None:
        return await _create_at_provider(conn, settings, booking=booking, user=user, payment=live, amount=amount)

    # There is already a payment page: make sure it is still alive (the customer may have paid or abandoned it).
    live = await sync_payment(conn, settings, live)
    if live["status"] == "succeeded":
        raise APIError("Эта тренировка уже оплачена.", code="already_paid", status_code=409)
    if live["status"] == "canceled":  # expired or declined: a fresh attempt
        return await start_payment(conn, settings, booking=booking, user=user, ip=ip)
    return live


async def _create_at_provider(
    conn: asyncpg.Connection, settings: Settings, *, booking: dict[str, Any], user: dict[str, Any], payment: dict[str, Any], amount: Decimal
) -> dict[str, Any]:
    try:
        data = await get_client(settings).create_payment(
            amount=amount,
            currency=booking["currency"],
            description=_description(booking),
            return_url=_return_url(settings, booking["id"]),
            idempotence_key=str(payment["idempotence_key"]),
            metadata={"booking_id": str(booking["id"]), "payment_id": str(payment["id"])},
            receipt=_receipt(settings, booking, user, amount),
        )
        url = (data.get("confirmation") or {}).get("confirmation_url")
        provider_id = data.get("id")
        if not isinstance(provider_id, str) or not isinstance(url, str) or not url.startswith("https://"):
            raise YooKassaError("ЮKassa answered without a payment page")
    except YooKassaError as exc:
        logger.warning("Could not start a payment for booking %s: %s", booking["id"], exc)
        if not exc.retryable:
            # The provider will never accept this request: free the booking for another attempt.
            await payments_repo.mark_canceled(conn, payment["id"], "provider_rejected")
        raise APIError(
            "Не удалось открыть страницу оплаты. Попробуйте ещё раз через минуту.", code="payment_provider_error", status_code=502
        ) from exc
    await payments_repo.attach_provider_payment(conn, payment["id"], provider_payment_id=provider_id, confirmation_url=url)
    return {**payment, "provider_payment_id": provider_id, "confirmation_url": url}


async def sync_payment(conn: asyncpg.Connection, settings: Settings, payment: dict[str, Any]) -> dict[str, Any]:
    """Reads the payment back from ЮKassa and applies the outcome. Safe to call any number of times, from any number of places."""
    if payment["status"] != "pending" or not payment["provider_payment_id"] or not settings.payments_enabled:
        return payment
    data = await get_client(settings).get_payment(payment["provider_payment_id"])
    status = data.get("status")
    if status == "succeeded":
        if _matches(payment, data):
            await payments_repo.mark_succeeded(conn, payment["id"])
        else:
            logger.error("Payment %s: ЮKassa reports a success that does not match what was requested - NOT applied", payment["id"])
    elif status == "canceled":
        reason = (data.get("cancellation_details") or {}).get("reason")
        await payments_repo.mark_canceled(conn, payment["id"], reason if isinstance(reason, str) else None)
    refreshed = await payments_repo.get_by_provider_id(conn, payment["provider_payment_id"])
    return refreshed or payment


def _matches(payment: dict[str, Any], data: dict[str, Any]) -> bool:
    try:
        amount = data["amount"]
        return (
            data.get("id") == payment["provider_payment_id"]
            and data.get("paid") is True
            and Decimal(str(amount["value"])) == Decimal(payment["amount"])
            and amount["currency"] == payment["currency"]
        )
    except (KeyError, InvalidOperation, TypeError):
        return False
