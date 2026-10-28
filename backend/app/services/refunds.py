"""Refunds through ЮKassa, and how they reach the books.

Money moves back only when ЮKassa says the refund succeeded AND we have read that back ourselves (a webhook is just a hint).
A refund is asked for by a finance administrator (never automatically, never by the customer's request alone); the platform's
commission is returned in proportion (REFUND_RETURNS_COMMISSION); the trainer's share is taken from what is still pending, then from
what is available, and what cannot be taken (already reserved or paid out) becomes a visible DEBT of the trainer - nothing is
written off silently and nothing is taken from a bank card automatically.

Over the whole life of a payment: refunded <= paid (database CHECK), and the commission returned <= the commission taken."""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError, get_client
from app.repositories import earnings as earnings_repo
from app.repositories import ledger
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.repositories.ledger import Leg
from app.services import finance_notifications as notify
from app.services.money import split_refund

logger = logging.getLogger("teamflow.payments")

MIN_REFUND_KOPECKS = 100  # ЮKassa: a partial refund is at least 1 RUB, and what stays must be 0 or at least 1 RUB


async def request_refund(
    conn: asyncpg.Connection, settings: Settings, *, payment_id: UUID, amount_kopecks: int, reason: str, admin_user_id: UUID, attempt_id: UUID | None = None
) -> dict[str, Any]:
    """Asks for a refund. `attempt_id` is only given for refunding a DUPLICATE charge (an attempt in state duplicate_paid)."""
    if not settings.payments_enabled:
        raise APIError("Онлайн-платежи отключены.", code="payments_unavailable", status_code=503)
    if not reason.strip():
        raise APIError("Укажите причину возврата.", code="reason_required", status_code=422)
    async with conn.transaction():
        payment = await payments_repo.get_payment(conn, payment_id, lock=True)
        if payment is None:
            raise APIError("Платёж не найден.", code="payment_not_found", status_code=404)
        if attempt_id is not None:
            attempt = await payments_repo.get_attempt(conn, attempt_id)
            if attempt is None or attempt["payment_id"] != payment["id"] or attempt["status"] != "duplicate_paid":
                raise APIError("Это не дублирующий платёж.", code="not_a_duplicate", status_code=409)
            if amount_kopecks != payment["gross_kopecks"]:
                raise APIError("Дублирующий платёж возвращается целиком.", code="amount_invalid", status_code=422)
            if await conn.fetchval("SELECT 1 FROM refunds WHERE attempt_id = $1 AND status IN ('requested', 'pending', 'succeeded')", attempt_id):
                raise APIError("Возврат по этому платежу уже запрошен.", code="refund_exists", status_code=409)
            refund = await refunds_repo.insert(conn, payment_id=payment["id"], attempt_id=attempt_id, kind="duplicate", amount=amount_kopecks,
                                               commission=0, trainer=amount_kopecks, reason=reason.strip(), requested_by=admin_user_id)
        else:
            if payment["status"] not in ("paid", "partially_refunded"):
                raise APIError("Вернуть можно только оплаченный платёж.", code="not_refundable", status_code=409)
            attempt = await payments_repo.succeeded_attempt(conn, payment["id"])
            if attempt is None:
                raise APIError("Нет успешной оплаты для возврата.", code="not_refundable", status_code=409)
            room = payment["gross_kopecks"] - payment["refund_reserved_kopecks"]
            left_after = room - amount_kopecks
            if amount_kopecks < MIN_REFUND_KOPECKS or amount_kopecks > room or (0 < left_after < MIN_REFUND_KOPECKS):
                raise APIError("Недопустимая сумма возврата: от 1 ₽, не больше остатка, и остаток должен быть 0 либо не меньше 1 ₽.",
                               code="amount_invalid", status_code=422)
            done = await refunds_repo.sums_for_payment(conn, payment["id"])
            commission, trainer = split_refund(
                amount_kopecks, gross_kopecks=payment["gross_kopecks"], fee_kopecks=payment["platform_fee_kopecks"],
                fee_already_refunded=done["commission"], refunded_before=done["amount"], return_commission=settings.refund_returns_commission,
            )
            refund = await refunds_repo.insert(conn, payment_id=payment["id"], attempt_id=attempt["id"], kind="payment", amount=amount_kopecks,
                                               commission=commission, trainer=trainer, reason=reason.strip(), requested_by=admin_user_id)
            # Reserving the amount first is what makes "refunds never exceed the payment" hold under races (CHECK in the database).
            await conn.execute(
                "UPDATE payments SET refund_reserved_kopecks = refund_reserved_kopecks + $2, updated_at = now() WHERE id = $1", payment["id"], amount_kopecks
            )
    return await _send_to_provider(conn, settings, refund)


async def _send_to_provider(conn: asyncpg.Connection, settings: Settings, refund: dict[str, Any]) -> dict[str, Any]:
    attempt = await payments_repo.get_attempt(conn, refund["attempt_id"])
    payment = await payments_repo.get_payment(conn, refund["payment_id"])
    assert attempt is not None and payment is not None and attempt["provider_payment_id"]
    try:
        data = await get_client(settings).create_refund(
            provider_payment_id=attempt["provider_payment_id"], amount_kopecks=refund["amount_kopecks"], currency=payment["currency"],
            description=refund["reason"], idempotence_key=str(refund["idempotence_key"]),
        )
        provider_id = data.get("id")
        if not isinstance(provider_id, str):
            raise YooKassaError("ЮKassa answered without a refund id")
    except YooKassaError as exc:
        logger.warning("Refund %s could not be sent: %s", refund["id"], exc)
        if not exc.retryable:
            await _fail_refund(conn, refund, f"provider_rejected: {exc.status_code}")
        # a retryable failure leaves it 'requested': the same Idempotence-Key makes the retry (reconciliation) safe
        raise APIError("Не удалось отправить возврат в ЮKassa. Запрос сохранён, повторите позже.", code="payment_provider_error", status_code=502) from exc
    await refunds_repo.attach_provider(conn, refund["id"], provider_id)
    refund = await refunds_repo.get(conn, refund["id"]) or refund
    if data.get("status") == "succeeded":
        refund = await sync_refund(conn, settings, refund, source="api")
    return refund


async def _fail_refund(conn: asyncpg.Connection, refund: dict[str, Any], reason: str | None) -> None:
    async with conn.transaction():
        if await refunds_repo.mark_failed(conn, refund["id"], reason) and refund["kind"] == "payment":
            await conn.execute(
                "UPDATE payments SET refund_reserved_kopecks = refund_reserved_kopecks - $2, updated_at = now() WHERE id = $1",
                refund["payment_id"], refund["amount_kopecks"],
            )


async def sync_refund(conn: asyncpg.Connection, settings: Settings, refund: dict[str, Any], *, source: str = "api") -> dict[str, Any]:
    if refund["status"] not in ("requested", "pending"):
        return refund
    if not refund["provider_refund_id"]:
        return await _send_to_provider(conn, settings, refund)  # the creation call never got an answer: repeat it (same key)
    data = await get_client(settings).get_refund(refund["provider_refund_id"])
    status = data.get("status")
    if status == "succeeded":
        payment = await payments_repo.get_payment(conn, refund["payment_id"])
        amount = data.get("amount") or {}
        try:
            from app.services.money import rub_to_kopecks

            same = rub_to_kopecks(str(amount["value"])) == refund["amount_kopecks"] and amount.get("currency") == (payment or {}).get("currency")
        except (KeyError, ValueError, TypeError):
            same = False
        if not same:
            if await payments_repo.record_incident(conn, kind="refund_mismatch", payment_id=refund["payment_id"], attempt_id=refund["attempt_id"],
                                                   detail="the provider's refund differs from the one requested"):
                await notify.incident(conn, settings, kind="refund_mismatch", payment_id=refund["payment_id"], key=str(refund["id"]))
            await payments_repo.record_event(conn, source=source, event="refund.succeeded", provider_object_id=refund["provider_refund_id"], outcome="mismatch")
        else:
            await _finalize_refund(conn, settings, refund["id"])
            await payments_repo.record_event(conn, source=source, event="refund.succeeded", provider_object_id=refund["provider_refund_id"], outcome="applied")
    elif status == "canceled":
        reason = (data.get("cancellation_details") or {}).get("reason")
        await _fail_refund(conn, refund, reason if isinstance(reason, str) else "canceled")
        if await payments_repo.record_incident(conn, kind="refund_failed", payment_id=refund["payment_id"], attempt_id=refund["attempt_id"],
                                               detail=f"the provider canceled the refund ({reason})"):
            await notify.incident(conn, settings, kind="refund_failed", payment_id=refund["payment_id"], key=str(refund["id"]))
    return await refunds_repo.get(conn, refund["id"]) or refund


async def _finalize_refund(conn: asyncpg.Connection, settings: Settings, refund_id: UUID) -> None:
    async with conn.transaction():
        refund = await refunds_repo.get(conn, refund_id, lock=True)
        assert refund is not None
        payment = await payments_repo.get_payment(conn, refund["payment_id"], lock=True)
        assert payment is not None
        if not await refunds_repo.mark_succeeded(conn, refund_id):
            return  # already counted
        if refund["kind"] == "duplicate":
            # The second charge was never booked, so giving it back changes nothing in the books.
            return
        await conn.execute(
            "UPDATE payments SET refunded_kopecks = refunded_kopecks + $2, "
            "status = CASE WHEN refunded_kopecks + $2 >= gross_kopecks THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now() WHERE id = $1",
            payment["id"], refund["amount_kopecks"],
        )
        earning = await earnings_repo.get_for_payment(conn, payment["id"], lock=True)
        coach = payment["coach_user_id"]
        legs: list[Leg] = [Leg("provider_receivable", "credit", refund["amount_kopecks"])]
        if refund["commission_refund_kopecks"] > 0:
            legs.append(Leg("platform_revenue", "debit", refund["commission_refund_kopecks"]))
        trainer_part = refund["trainer_refund_kopecks"]
        debt = 0
        if trainer_part > 0:
            balances = await ledger.trainer_balances(conn, coach, lock=True)
            source = "trainer_pending" if earning and earning["status"] in ("pending", "held") else "trainer_available"
            taken = min(trainer_part, balances[source])
            if taken > 0:
                legs.append(Leg(source, "debit", taken, owner=coach))
            debt = trainer_part - taken
            if debt > 0:
                legs.append(Leg("trainer_debt", "debit", debt, owner=coach))
        await ledger.post(
            conn, kind="refund", business_key=f"refund:{refund_id}:done", description="Возврат игроку", payment_id=payment["id"],
            booking_id=payment["booking_id"], refund_id=refund_id, created_by=refund["requested_by"], reason=refund["reason"], legs=legs,
        )
        if earning is not None and trainer_part > 0:
            await earnings_repo.add_reversal(conn, earning["id"], trainer_part)
        if debt > 0 and await payments_repo.record_incident(
            conn, kind="trainer_debt", payment_id=payment["id"], attempt_id=refund["attempt_id"],
            detail=f"{debt} kopecks of the refund could not be taken from the trainer's balance and are recorded as a debt",
        ):
            await notify.incident(conn, settings, kind="trainer_debt", payment_id=payment["id"], key=str(refund_id))
        await notify.refund_done(conn, payment, refund)
