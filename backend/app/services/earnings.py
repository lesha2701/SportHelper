"""Moving a trainer's earning from "pending" to "available" - the moment money becomes withdrawable.

A payment alone never makes money withdrawable: the trainer must have marked the session as conducted, and (by default) a finance
administrator checks and releases it. The trainer's own mark is a self-attestation, so it only STARTS the process. The automatic mode
(EARNING_RELEASE_MODE=auto_after_hold) releases an earning EARNING_HOLD_HOURS after that mark, unless an administrator froze it."""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import asyncpg

from app.config import Settings
from app.core.exceptions import APIError
from app.repositories import earnings as earnings_repo
from app.repositories import ledger
from app.repositories.ledger import Leg
from app.services import finance_notifications as notify

logger = logging.getLogger("teamflow.finance")


async def release_earning(
    conn: asyncpg.Connection, settings: Settings, earning_id: UUID, *, by: UUID | None, note: str | None = None
) -> dict[str, Any]:
    """Idempotent: releasing an already released earning returns it unchanged."""
    async with conn.transaction():
        earning = await earnings_repo.get(conn, earning_id, lock=True)
        if earning is None:
            raise APIError("Начисление не найдено.", code="earning_not_found", status_code=404)
        if earning["status"] == "available":
            return earning
        if earning["status"] == "held":
            raise APIError("Начисление заморожено: сначала снимите заморозку.", code="earning_held", status_code=409)
        if earning["status"] != "pending":
            raise APIError("Это начисление нельзя выпустить.", code="earning_not_releasable", status_code=409)
        if earning["session_confirmed_at"] is None:
            raise APIError("Тренер ещё не отметил тренировку проведённой.", code="session_not_confirmed", status_code=409)
        amount = earning["trainer_kopecks"] - earning["reversed_kopecks"]
        if amount <= 0:
            raise APIError("Нечего выпускать: начисление полностью возвращено.", code="earning_not_releasable", status_code=409)
        before = await ledger.balance(conn, "trainer_available", earning["coach_user_id"])
        await ledger.post(
            conn, kind="earning_released", business_key=f"earning:{earning_id}:released", description="Начисление доступно к выводу",
            payment_id=earning["payment_id"], booking_id=earning["booking_id"], earning_id=earning_id, created_by=by, reason=note,
            legs=[Leg("trainer_pending", "debit", amount, earning["coach_user_id"]), Leg("trainer_available", "credit", amount, earning["coach_user_id"])],
        )
        await earnings_repo.release(conn, earning_id, by=by, note=note)
        await notify.earning_available(conn, earning, amount_kopecks=amount)
        minimum = settings.trainer_min_withdrawal_rub * 100
        if before < minimum <= before + amount:
            await notify.threshold_reached(conn, earning["coach_user_id"], earning_id, available_kopecks=before + amount, minimum_kopecks=minimum)
        return await earnings_repo.get(conn, earning_id) or earning


async def release_due_earnings(conn: asyncpg.Connection, settings: Settings) -> int:
    """The automatic mode: a bounded batch per tick."""
    if settings.earning_release_mode != "auto_after_hold":
        return 0
    released = 0
    for earning in await earnings_repo.due_for_auto_release(conn, hold_hours=settings.earning_hold_hours, limit=50):
        try:
            await release_earning(conn, settings, earning["id"], by=None, note="auto release after the hold period")
            released += 1
        except APIError:
            continue
    return released

