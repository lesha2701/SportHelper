"""The «Финансы» section of the administration panel. Not a separate admin system: the same sessions, the same second factor, the
same audit trail - plus FINANCE_ADMIN_EMAILS, so an ordinary administrator cannot see or move money.

Reading needs a finance administrator with the second factor in this session; every change is rate limited and audited; the actions
that decide where money goes (release, refund, approve, confirm a payout, reject, read payout details) additionally need the second
factor entered within the last few minutes. Nothing here sends money: confirming a payout RECORDS a transfer someone made in the bank."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, get_settings_dep, require_finance_admin, require_finance_recent_mfa, require_finance_write
from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.integrations.yookassa import YooKassaError
from app.repositories import earnings as earnings_repo
from app.repositories import finance_views
from app.repositories import ledger
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.repositories import withdrawals as withdrawals_repo
from app.schemas.finance import MarkPaidIn, OptionalNoteIn, ReasonIn, RefundIn, RejectIn, ResolveIncidentIn
from app.services import admin_audit
from app.services import earnings as earnings_service
from app.services import payout_details
from app.services import refunds as refunds_service
from app.services import withdrawals as withdrawals_service

router = APIRouter(prefix="/api/admin/finance", tags=["admin-finance"])

_WITHDRAWAL_STATUSES = {"requested", "under_review", "approved", "processing", "paid", "rejected", "canceled"}
_EARNING_STATUSES = {"pending", "held", "available", "reversed"}


def _page(limit: int, offset: int, total: int, items: list[Any]) -> dict[str, Any]:
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/overview")
async def overview(
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> dict[str, Any]:
    """Gross turnover, the platform's commission, what is owed to trainers by stage, what was paid out, refunds, problems. The
    figures are kept apart on purpose: money received from players is NOT the platform's income - only `commission` is."""
    data = await finance_views.overview(conn)
    totals = await ledger.platform_totals(conn)
    mismatches = await ledger.recompute_mismatches(conn)
    return {
        "flags": {
            "payments": settings.payments_enabled, "trainer_balance": settings.trainer_balance_enabled,
            "withdrawals": settings.trainer_withdrawals_enabled, "payout_confirmation": settings.trainer_payout_confirmation_enabled,
            "two_person_rule": settings.finance_two_person_rule, "release_mode": settings.earning_release_mode,
        },
        "commission_percent": str(settings.platform_commission_percent),
        "min_withdrawal_kopecks": settings.trainer_min_withdrawal_rub * 100,
        "payments": data["payments"],
        "gross_received_kopecks": data["payments"]["gross"] - data["payments"]["refunded"],
        "platform_commission_kopecks": totals["platform_revenue"],       # net of commission returned with refunds
        "owed_to_trainers": {"pending_kopecks": totals["trainer_pending"], "available_kopecks": totals["trainer_available"], "reserved_kopecks": totals["trainer_reserved"]},
        "paid_out_kopecks": totals["payouts_external"],
        "trainer_debts_kopecks": totals["trainer_debt"],
        "held_by_provider_kopecks": totals["provider_receivable"],
        "earnings": data["earnings"],
        "withdrawals": data["withdrawals"],
        "pending_withdrawals": sum(v["count"] for k, v in data["withdrawals"].items() if k in ("requested", "under_review", "approved", "processing")),
        "open_incidents": data["open_incidents"],
        "ledger_mismatches": len(mismatches),
        # Not recorded by the site: they come from ЮKassa's reports and the bank statement (see docs/finance.md).
        "provider_fees_kopecks": None,
        "bank_receipts_kopecks": None,
    }


@router.get("/integrity")
async def integrity(ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    """Recomputes every account from its entries and compares with the stored balance (must always be empty)."""
    mismatches = await ledger.recompute_mismatches(conn)
    balanced = await conn.fetchval(
        "SELECT COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'debit'), 0) = COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'credit'), 0) FROM ledger_entries"
    )
    return {"balanced": bool(balanced), "mismatches": [{"account": m["code"], "stored": m["stored"], "computed": m["computed"]} for m in mismatches]}


# --- payments ---------------------------------------------------------------------------------------------------------------


@router.get("/payments")
async def payments(
    status: str | None = Query(None, pattern="^(awaiting|paid|partially_refunded|refunded)$"), q: str | None = Query(None, max_length=100),
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    total, rows = await finance_views.admin_payments(conn, status=status, query=q, limit=limit, offset=offset)
    return _page(limit, offset, total, rows)


@router.get("/payments/{payment_id}")
async def payment_detail(payment_id: UUID, ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    detail = await finance_views.payment_detail(conn, payment_id)
    if detail is None:
        raise NotFoundError("payment not found")
    return detail


@router.post("/payments/{payment_id}/refund")
async def refund_payment(
    payment_id: UUID, payload: RefundIn,
    ctx: AuthContext = Depends(require_finance_recent_mfa), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Asks ЮKassa for a refund. The money is booked only when ЮKassa confirms it (and we read that back)."""
    try:
        refund = await refunds_service.request_refund(
            conn, settings, payment_id=payment_id, amount_kopecks=payload.amount_kopecks, reason=payload.reason, admin_user_id=ctx.user["id"], attempt_id=payload.attempt_id
        )
    except APIError as exc:
        await admin_audit.record(conn, ctx.user["id"], "finance.refund.request", target_type="payment", target_id=payment_id, reason=payload.reason,
                                 extra={"amount_kopecks": payload.amount_kopecks, "error": exc.code}, result="denied" if exc.status_code < 500 else "failed")
        raise
    await admin_audit.record(conn, ctx.user["id"], "finance.refund.request", target_type="payment", target_id=payment_id, reason=payload.reason,
                             extra={"amount_kopecks": payload.amount_kopecks, "refund_id": refund["id"], "kind": refund["kind"]})
    return refund


@router.get("/refunds")
async def refunds(
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    total, rows = await refunds_repo.list_for_admin(conn, limit=limit, offset=offset)
    return _page(limit, offset, total, rows)


# --- incidents ---------------------------------------------------------------------------------------------------------------


@router.get("/incidents")
async def incidents(
    status: str | None = Query(None, pattern="^(open|resolved)$"), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    total, rows = await finance_views.incidents(conn, status=status, limit=limit, offset=offset)
    return _page(limit, offset, total, rows)


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: int, payload: ResolveIncidentIn, ctx: AuthContext = Depends(require_finance_write), conn: asyncpg.Connection = Depends(get_db)
) -> dict[str, Any]:
    async with conn.transaction():
        row = await conn.fetchrow(
            "UPDATE payment_incidents SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3 WHERE id = $1 AND status = 'open' RETURNING id",
            incident_id, ctx.user["id"], payload.resolution.strip(),
        )
        if row is None:
            raise APIError("Инцидент не найден или уже закрыт.", code="incident_not_open", status_code=409)
        await admin_audit.record(conn, ctx.user["id"], "finance.incident.resolve", target_type="incident", target_id=str(incident_id), reason=payload.resolution)
    return {"id": incident_id, "status": "resolved"}


# --- earnings ---------------------------------------------------------------------------------------------------------------


@router.get("/earnings")
async def earnings(
    status: str | None = Query(None), coach_id: UUID | None = None, limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if status is not None and status not in _EARNING_STATUSES:
        raise APIError("Неизвестный статус.", code="validation_error", status_code=422)
    total, rows = await earnings_repo.list_for_admin(conn, status=status, coach_user_id=coach_id, limit=limit, offset=offset)
    return _page(limit, offset, total, rows)


@router.post("/earnings/{earning_id}/release")
async def release_earning(
    earning_id: UUID, payload: OptionalNoteIn,
    ctx: AuthContext = Depends(require_finance_recent_mfa), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Makes a trainer's earning withdrawable, after the administrator has checked the session really took place."""
    async with conn.transaction():
        before = await earnings_repo.get(conn, earning_id)
        try:
            earning = await earnings_service.release_earning(conn, settings, earning_id, by=ctx.user["id"], note=payload.note)
        except APIError as exc:
            await admin_audit.record(conn, ctx.user["id"], "finance.earning.release", target_type="earning", target_id=earning_id, result="denied", extra={"error": exc.code})
            raise
        await admin_audit.record(conn, ctx.user["id"], "finance.earning.release", target_type="earning", target_id=earning_id, reason=payload.note,
                                 before={"status": before["status"] if before else None}, after={"status": earning["status"]},
                                 extra={"trainer_kopecks": earning["trainer_kopecks"]})
    return earning


@router.post("/earnings/{earning_id}/hold")
async def hold_earning(earning_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_finance_write), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    """Freezes a disputed earning: it cannot be released until someone lifts the hold."""
    async with conn.transaction():
        if not await earnings_repo.hold(conn, earning_id, payload.reason.strip()):
            raise APIError("Заморозить можно только начисление в ожидании.", code="earning_not_holdable", status_code=409)
        await admin_audit.record(conn, ctx.user["id"], "finance.earning.hold", target_type="earning", target_id=earning_id, reason=payload.reason)
    return {"id": earning_id, "status": "held"}


@router.post("/earnings/{earning_id}/unhold")
async def unhold_earning(earning_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_finance_write), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    async with conn.transaction():
        if not await earnings_repo.unhold(conn, earning_id):
            raise APIError("Это начисление не заморожено.", code="earning_not_held", status_code=409)
        await admin_audit.record(conn, ctx.user["id"], "finance.earning.unhold", target_type="earning", target_id=earning_id, reason=payload.reason)
    return {"id": earning_id, "status": "pending"}


@router.get("/trainers/{coach_id}")
async def trainer(coach_id: UUID, ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    info = await finance_views.trainer_summary(conn, coach_id)
    if info is None:
        raise NotFoundError("trainer not found")
    balances = await ledger.trainer_balances(conn, coach_id)
    _, ops = await finance_views.trainer_operations(conn, coach_id, limit=20, offset=0)
    return {"trainer": info, "balances": balances, "paid_out_kopecks": await withdrawals_repo.paid_total_for_coach(conn, coach_id), "recent_operations": ops}


# --- withdrawals ------------------------------------------------------------------------------------------------------------


@router.get("/withdrawals")
async def withdrawals(
    status: str | None = Query(None), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if status is not None and status not in _WITHDRAWAL_STATUSES:
        raise APIError("Неизвестный статус.", code="validation_error", status_code=422)
    total, rows = await withdrawals_repo.list_for_admin(conn, status=status, limit=limit, offset=offset)
    return _page(limit, offset, total, rows)


@router.get("/withdrawals/{withdrawal_id}")
async def withdrawal_detail(withdrawal_id: UUID, ctx: AuthContext = Depends(require_finance_admin), conn: asyncpg.Connection = Depends(get_db)) -> dict[str, Any]:
    withdrawal = await withdrawals_repo.get(conn, withdrawal_id)
    if withdrawal is None:
        raise NotFoundError("withdrawal not found")
    balances = await ledger.trainer_balances(conn, withdrawal["coach_user_id"])
    coach = await finance_views.trainer_summary(conn, withdrawal["coach_user_id"])
    # The same two fields the list carries, so the drawer can say whose request it is.
    withdrawal = {**withdrawal, "coach_full_name": coach["full_name"] if coach else None, "coach_email": coach["email"] if coach else None}
    return {"withdrawal": withdrawal, "events": await withdrawals_repo.events(conn, withdrawal_id), "trainer_balances": balances}


@router.post("/withdrawals/{withdrawal_id}/details")
async def withdrawal_payout_details(
    withdrawal_id: UUID, ctx: AuthContext = Depends(require_finance_recent_mfa), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> dict[str, Any]:
    """The recipient's full payout details - only on this explicit action, and every view is written to the audit trail."""
    withdrawal = await withdrawals_repo.get(conn, withdrawal_id)
    token = await withdrawals_repo.get_encrypted_details(conn, withdrawal_id)
    if withdrawal is None or token is None:
        raise NotFoundError("withdrawal not found")
    await admin_audit.record(conn, ctx.user["id"], "finance.withdrawal.details_viewed", target_type="withdrawal", target_id=withdrawal_id)
    details = payout_details.decrypt(token, settings)
    if details is None:
        raise APIError("Реквизиты не удалось расшифровать.", code="details_unreadable", status_code=500)
    return {"method": withdrawal["method"], "details": details}


def _step(action: str, *, dangerous: bool):
    dependency = require_finance_recent_mfa if dangerous else require_finance_write

    async def handler(
        withdrawal_id: UUID, payload: OptionalNoteIn,
        ctx: AuthContext = Depends(dependency), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
    ) -> dict[str, Any]:
        return await withdrawals_service.admin_step(conn, settings, admin=ctx.user, withdrawal_id=withdrawal_id, action=action, reason=payload.note)

    handler.__name__ = f"withdrawal_{action}"
    return handler


router.add_api_route("/withdrawals/{withdrawal_id}/review", _step("review", dangerous=False), methods=["POST"])
router.add_api_route("/withdrawals/{withdrawal_id}/approve", _step("approve", dangerous=True), methods=["POST"])
router.add_api_route("/withdrawals/{withdrawal_id}/processing", _step("start_processing", dangerous=False), methods=["POST"])


@router.post("/withdrawals/{withdrawal_id}/paid")
async def withdrawal_paid(
    withdrawal_id: UUID, payload: MarkPaidIn,
    ctx: AuthContext = Depends(require_finance_recent_mfa), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    """Records that the transfer was made in the bank (a person did it). Needs the bank's operation id and the exact amount."""
    return await withdrawals_service.admin_step(
        conn, settings, admin=ctx.user, withdrawal_id=withdrawal_id, action="mark_paid", bank_reference=payload.bank_reference,
        paid_amount_kopecks=payload.paid_amount_kopecks, paid_at=payload.paid_at, transfer_note=payload.transfer_note,
    )


@router.post("/withdrawals/{withdrawal_id}/reject")
async def withdrawal_reject(
    withdrawal_id: UUID, payload: RejectIn,
    ctx: AuthContext = Depends(require_finance_recent_mfa), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    return await withdrawals_service.admin_step(
        conn, settings, admin=ctx.user, withdrawal_id=withdrawal_id, action="reject", reason=payload.reason, confirm_not_sent=payload.confirm_not_sent
    )
