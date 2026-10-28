"""The trainer's own finance screens: balance, money history, withdrawal requests.

Everything is about the CURRENT user (an id in a URL can only be his own withdrawal), read-only except the two actions a trainer
legitimately has: ask for a withdrawal and cancel one that has not gone to payment yet. There is no endpoint that adds money.
Switched on by TRAINER_BALANCE_ENABLED (withdrawals additionally by TRAINER_WITHDRAWALS_ENABLED)."""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError
from app.repositories import finance_views
from app.repositories import ledger
from app.repositories import profiles as profiles_repo
from app.repositories import withdrawals as withdrawals_repo
from app.schemas.finance import WithdrawalCreateIn
from app.services import accounts as accounts_service
from app.services import email_templates as templates
from app.services import withdrawals as withdrawals_service
from app.services.money import format_rub

router = APIRouter(prefix="/api/finance", tags=["finance"])


async def trainer_user(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    if not settings.trainer_balance_enabled:
        raise APIError("Раздел «Финансы» пока недоступен.", code="finance_unavailable", status_code=503)
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise APIError("Раздел доступен только тренерам.", code="not_a_coach", status_code=403)
    return user


def _withdrawal_out(w: dict[str, Any]) -> dict[str, Any]:
    return {k: w[k] for k in ("id", "amount_kopecks", "currency", "status", "method", "details_hint", "decided_reason", "paid_at", "created_at", "updated_at")}


@router.get("/summary")
async def summary(
    user: dict = Depends(trainer_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> dict[str, Any]:
    balances = await ledger.trainer_balances(conn, user["id"])
    minimum = settings.trainer_min_withdrawal_rub * 100
    available = balances["trainer_available"]
    return {
        "currency": "RUB",
        "available_kopecks": available,
        "pending_kopecks": balances["trainer_pending"],
        "reserved_kopecks": balances["trainer_reserved"],
        "paid_out_kopecks": await withdrawals_repo.paid_total_for_coach(conn, user["id"]),
        "debt_kopecks": balances["trainer_debt"],
        "minimum_withdrawal_kopecks": minimum,
        "withdrawals_enabled": settings.trainer_withdrawals_enabled,
        "can_withdraw": settings.trainer_withdrawals_enabled and available >= minimum,
        "shortfall_kopecks": max(minimum - available, 0),
        "commission_percent": str(settings.platform_commission_percent),
    }


@router.get("/operations")
async def operations(
    limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    user: dict = Depends(trainer_user), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    total, rows = await finance_views.trainer_operations(conn, user["id"], limit=limit, offset=offset)
    return {"total": total, "limit": limit, "offset": offset, "items": rows}


@router.get("/withdrawals")
async def my_withdrawals(
    limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=100_000),
    user: dict = Depends(trainer_user), conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    total, rows = await withdrawals_repo.list_for_coach(conn, user["id"], limit=limit, offset=offset)
    return {"total": total, "limit": limit, "offset": offset, "items": [_withdrawal_out(w) for w in rows]}


@router.post("/withdrawals", status_code=201)
async def request_withdrawal(
    payload: WithdrawalCreateIn, response: Response, background: BackgroundTasks,
    user: dict = Depends(trainer_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    withdrawal, created = await withdrawals_service.create_withdrawal(
        conn, settings, user=user, amount_kopecks=payload.amount_kopecks, method=payload.method, raw_details=payload.details,
        client_key=payload.client_key, password=payload.password,
    )
    if not created:
        response.status_code = 200  # the same form sent again: the first request is returned, nothing new is created
    elif user.get("email"):
        # A security notice to the owner of the account (to catch a hijacked session), sent after everything is saved.
        accounts_service.queue_email(
            background, templates.withdrawal_requested_email(settings, user["email"], user["first_name"], format_rub(withdrawal["amount_kopecks"])), settings
        )
    return _withdrawal_out(withdrawal)


@router.post("/withdrawals/{withdrawal_id}/cancel")
async def cancel_withdrawal(
    withdrawal_id: UUID, user: dict = Depends(trainer_user), conn: asyncpg.Connection = Depends(get_db), settings: Settings = Depends(get_settings_dep)
) -> dict[str, Any]:
    return _withdrawal_out(await withdrawals_service.cancel_by_coach(conn, settings, user=user, withdrawal_id=withdrawal_id))
