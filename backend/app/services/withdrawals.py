"""Withdrawal requests: reserving the trainer's money, and the manual payout process around it.

Money rules (all enforced here AND by the database):
  * a request needs the available balance (never pending money) and at least TRAINER_MIN_WITHDRAWAL_RUB;
  * creating one atomically moves the amount available -> reserved under the account's row lock, so two parallel requests can never
    reserve the same money and an overdraft is impossible;
  * the same form sent twice (double click, retry) carries the same client key and yields ONE request;
  * the status machine allows only the steps in repositories.withdrawals.TRANSITIONS; every step is a guarded update, so two
    administrators cannot both apply it; a REAL payout can be confirmed only with a bank reference (unique), the exact amount, and
    only while TRAINER_PAYOUT_CONFIRMATION_ENABLED is on;
  * releasing a reservation (reject / cancel) is automatic only BEFORE a transfer started; once it is "processing" the money is never
    returned on its own - an administrator must explicitly state the transfer was not sent;
  * nothing here sends money: "paid" records that a person did the transfer in the bank.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.repositories import ledger
from app.repositories import rate_limits as rate_limits_repo
from app.repositories import users as users_repo
from app.repositories import withdrawals as repo
from app.repositories.ledger import Leg
from app.services import accounts as svc
from app.services import admin_audit
from app.services import finance_notifications as notify
from app.services import payout_details


def _reserve_legs(coach: UUID, amount: int) -> list[Leg]:
    return [Leg("trainer_available", "debit", amount, coach), Leg("trainer_reserved", "credit", amount, coach)]


async def create_withdrawal(
    conn: asyncpg.Connection, settings: Settings, *, user: dict[str, Any], amount_kopecks: int, method: str, raw_details: Any,
    client_key: UUID, password: str,
) -> tuple[dict[str, Any], bool]:
    """(request, created). `created` is False when the same client key was already used (the earlier request is returned)."""
    if not settings.trainer_withdrawals_enabled:
        raise APIError("Вывод средств пока недоступен.", code="withdrawals_unavailable", status_code=503)
    minimum = settings.trainer_min_withdrawal_rub * 100
    if amount_kopecks < minimum:
        raise APIError(f"Минимальная сумма вывода — {settings.trainer_min_withdrawal_rub} ₽.", code="below_minimum", status_code=422, field="amount")
    existing = await repo.get_by_client_key(conn, user["id"], client_key)
    if existing is not None:
        return existing, False
    details = payout_details.validate(method, raw_details)

    # Step-up against a hijacked session: the account password again (rate limited), before any money is touched.
    if settings.auth_rate_limit_enabled:
        allowed, retry_after = await rate_limits_repo.hit(conn, f"withdraw_password:{user['id']}", 10, 15 * 60)
        if not allowed:
            raise APIError("Слишком много попыток. Подождите немного.", code="rate_limited", status_code=429, retry_after=retry_after)
    stored = await users_repo.get_password_hash(conn, user["id"])
    if not stored or not await svc.verify_in_thread(password, stored, settings):
        raise APIError("Неверный пароль.", code="invalid_password", status_code=403, field="password")
    if settings.auth_rate_limit_enabled:
        allowed, retry_after = await rate_limits_repo.hit(conn, f"withdraw_create:{user['id']}", settings.withdrawal_requests_per_hour, 3600)
        if not allowed:
            raise APIError("Слишком много заявок за час. Попробуйте позже.", code="rate_limited", status_code=429, retry_after=retry_after)

    async with conn.transaction():
        available = await ledger.lock_trainer_available(conn, user["id"])  # serialises everything that spends this trainer's money
        if amount_kopecks > available:
            raise APIError("Недостаточно доступных средств для вывода.", code="insufficient_balance", status_code=409, field="amount")
        withdrawal = await repo.insert(
            conn, coach_user_id=user["id"], amount_kopecks=amount_kopecks, method=method, details_enc=payout_details.encrypt(details, settings),
            details_hint=payout_details.hint(method, details), client_key=client_key,
        )
        if withdrawal is None:  # a parallel identical request won the race
            return (await repo.get_by_client_key(conn, user["id"], client_key)), False  # type: ignore[return-value]
        await ledger.post(
            conn, kind="withdrawal_reserved", business_key=f"withdrawal:{withdrawal['id']}:reserved", description="Резерв под вывод",
            withdrawal_id=withdrawal["id"], created_by=user["id"], legs=_reserve_legs(user["id"], amount_kopecks),
        )
        await repo.add_event(conn, withdrawal["id"], from_status=None, to_status="requested", actor=user["id"], note=None)
        name = " ".join(p for p in (user.get("first_name"), user.get("last_name")) if p) or "Тренер"
        await notify.withdrawal_requested(conn, settings, withdrawal, name)
    return withdrawal, True


async def _release_reservation(conn: asyncpg.Connection, withdrawal: dict[str, Any], *, actor: UUID | None, reason: str | None) -> None:
    await ledger.post(
        conn, kind="withdrawal_released", business_key=f"withdrawal:{withdrawal['id']}:released", description="Резерв под вывод снят",
        withdrawal_id=withdrawal["id"], created_by=actor, reason=reason,
        legs=[Leg("trainer_reserved", "debit", withdrawal["amount_kopecks"], withdrawal["coach_user_id"]),
              Leg("trainer_available", "credit", withdrawal["amount_kopecks"], withdrawal["coach_user_id"])],
    )


async def cancel_by_coach(conn: asyncpg.Connection, settings: Settings, *, user: dict[str, Any], withdrawal_id: UUID) -> dict[str, Any]:
    async with conn.transaction():
        withdrawal = await repo.get(conn, withdrawal_id, lock=True)
        if withdrawal is None or withdrawal["coach_user_id"] != user["id"]:
            raise APIError("Заявка не найдена.", code="withdrawal_not_found", status_code=404)
        if withdrawal["status"] == "canceled":
            return withdrawal  # idempotent
        if withdrawal["status"] not in ("requested", "under_review"):
            raise APIError("Эту заявку уже нельзя отменить: она передана на выплату.", code="withdrawal_not_cancelable", status_code=409)
        if not await repo.move(conn, withdrawal_id, from_status=withdrawal["status"], to_status="canceled"):
            raise APIError("Статус заявки только что изменился.", code="withdrawal_changed", status_code=409)
        await _release_reservation(conn, withdrawal, actor=user["id"], reason="canceled by the trainer")
        await repo.add_event(conn, withdrawal_id, from_status=withdrawal["status"], to_status="canceled", actor=user["id"], note=None)
        updated = await repo.get(conn, withdrawal_id)
        await notify.withdrawal_status(conn, updated, "canceled")  # type: ignore[arg-type]
        return updated  # type: ignore[return-value]


class _Denied(Exception):
    """A step the rules refuse. Raised inside the step's transaction; the refusal is written to the audit trail AFTER that
    transaction has rolled back, so the record of the attempt survives."""

    def __init__(self, error: APIError, why: str):
        super().__init__(why)
        self.error, self.why = error, why


async def _record_denied(conn: asyncpg.Connection, admin: dict[str, Any], action: str, withdrawal_id: UUID, why: str) -> None:
    await admin_audit.record(conn, admin["id"], f"finance.withdrawal.{action}", target_type="withdrawal", target_id=withdrawal_id, reason=why, result="denied")


async def admin_step(
    conn: asyncpg.Connection, settings: Settings, *, admin: dict[str, Any], withdrawal_id: UUID, action: str, reason: str | None = None,
    bank_reference: str | None = None, paid_at: datetime | None = None, paid_amount_kopecks: int | None = None, transfer_note: str | None = None,
    confirm_not_sent: bool = False,
) -> dict[str, Any]:
    """review | approve | start_processing | mark_paid | reject. Idempotent: repeating the step that was just made returns the request."""
    steps = {"review": ("requested", "under_review", "reviewed_by"), "approve": ("under_review", "approved", "approved_by"),
             "start_processing": ("approved", "processing", "processing_by"), "mark_paid": ("processing", "paid", "paid_by"),
             "reject": (None, "rejected", None)}
    if action not in steps:
        raise APIError("Неизвестное действие.", code="unknown_action", status_code=422)
    try:
        return await _admin_step(conn, settings, admin=admin, withdrawal_id=withdrawal_id, action=action, steps=steps, reason=reason,
                                 bank_reference=bank_reference, paid_at=paid_at, paid_amount_kopecks=paid_amount_kopecks,
                                 transfer_note=transfer_note, confirm_not_sent=confirm_not_sent)
    except _Denied as denied:
        await _record_denied(conn, admin, action, withdrawal_id, denied.why)
        raise denied.error from None


async def _admin_step(
    conn: asyncpg.Connection, settings: Settings, *, admin: dict[str, Any], withdrawal_id: UUID, action: str, steps: dict, reason: str | None,
    bank_reference: str | None, paid_at: datetime | None, paid_amount_kopecks: int | None, transfer_note: str | None, confirm_not_sent: bool,
) -> dict[str, Any]:
    expected_from, target, actor_column = steps[action]

    async with conn.transaction():
        withdrawal = await repo.get(conn, withdrawal_id, lock=True)
        if withdrawal is None:
            raise APIError("Заявка не найдена.", code="withdrawal_not_found", status_code=404)
        current = withdrawal["status"]
        if current == target:
            return withdrawal  # the very same step was already made (double click / second administrator)
        if action == "reject":
            if current not in ("requested", "under_review", "approved", "processing"):
                raise APIError("Эту заявку уже нельзя отклонить.", code="invalid_transition", status_code=409)
            if not (reason or "").strip():
                raise APIError("Укажите причину отклонения.", code="reason_required", status_code=422, field="reason")
            if current == "processing" and not confirm_not_sent:
                # Money may be on its way: never return it on our own.
                raise APIError("Перевод уже выполняется. Если вы убедились, что деньги НЕ были отправлены, подтвердите это явно.",
                               code="confirm_not_sent_required", status_code=409)
        elif current != expected_from:
            raise APIError("Это действие недоступно для текущего статуса заявки.", code="invalid_transition", status_code=409)

        extra: dict[str, Any] = {}
        if action == "mark_paid":
            if not settings.trainer_payout_confirmation_enabled:
                raise _Denied(APIError("Подтверждение реальных выплат отключено в настройках.", code="payout_confirmation_disabled", status_code=409),
                              "payout confirmation is switched off")
            if settings.finance_two_person_rule and withdrawal["approved_by"] == admin["id"]:
                raise _Denied(APIError("Выплату должен подтвердить другой администратор, не тот, кто одобрил заявку.", code="two_person_rule", status_code=403),
                              "the approving administrator cannot confirm the payout")
            reference = (bank_reference or "").strip()
            if not (5 <= len(reference) <= 64) or not reference.replace("-", "").replace("_", "").replace("/", "").isalnum():
                raise APIError("Укажите банковский идентификатор операции (5–64 символа).", code="bank_reference_required", status_code=422, field="bank_reference")
            if paid_amount_kopecks != withdrawal["amount_kopecks"]:
                raise APIError("Сумма перевода должна совпадать с суммой заявки.", code="amount_mismatch", status_code=422, field="paid_amount")
            moment = paid_at or datetime.now(timezone.utc)
            if moment > datetime.now(timezone.utc) + timedelta(minutes=5) or moment < datetime.now(timezone.utc) - timedelta(days=60):
                raise APIError("Дата перевода указана неверно.", code="paid_at_invalid", status_code=422, field="paid_at")
            extra = {"bank_reference": reference, "paid_amount_kopecks": paid_amount_kopecks, "paid_at": moment, "transfer_note": (transfer_note or "")[:500] or None}
        try:
            async with conn.transaction():  # a savepoint: a refused statement must not poison the surrounding transaction
                moved = await repo.move(conn, withdrawal_id, from_status=current, to_status=target, actor_column=actor_column, actor=admin["id"],
                                        reason=(reason or None) if action == "reject" else None, **extra)
        except asyncpg.UniqueViolationError as exc:
            raise _Denied(APIError("Этот банковский идентификатор уже использован для другой выплаты.", code="bank_reference_used", status_code=409,
                                   field="bank_reference"), "the bank reference was already used") from exc
        if not moved:
            raise APIError("Статус заявки только что изменился.", code="withdrawal_changed", status_code=409)
        if action == "reject":
            await _release_reservation(conn, withdrawal, actor=admin["id"], reason=reason)
        elif action == "mark_paid":
            await ledger.post(
                conn, kind="withdrawal_paid", business_key=f"withdrawal:{withdrawal_id}:paid", description="Выплата тренеру проведена",
                withdrawal_id=withdrawal_id, created_by=admin["id"],
                legs=[Leg("trainer_reserved", "debit", withdrawal["amount_kopecks"], withdrawal["coach_user_id"]), Leg("payouts_external", "credit", withdrawal["amount_kopecks"])],
            )
        await repo.add_event(conn, withdrawal_id, from_status=current, to_status=target, actor=admin["id"], note=reason or transfer_note)
        updated = await repo.get(conn, withdrawal_id)
        assert updated is not None
        await admin_audit.record(conn, admin["id"], f"finance.withdrawal.{action}", target_type="withdrawal", target_id=withdrawal_id, reason=reason,
                                 before={"status": current}, after={"status": target},
                                 extra={"amount_kopecks": withdrawal["amount_kopecks"], "bank_reference": extra.get("bank_reference")})
        await notify.withdrawal_status(conn, updated, target, reason)
        return updated
