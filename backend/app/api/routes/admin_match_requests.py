"""The administrators' queue of «Подобрать тренера» requests. Taking and closing are recorded in the audit trail."""
from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, get_settings_dep, is_finance_admin, require_admin_mfa, require_admin_write
from app.config import Settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.repositories import match_offers as offers_repo
from app.repositories import match_requests as repo
from app.schemas.admin import PersonOut
from app.schemas.match_offers import AdminOfferOut, CandidateOut, CreateOfferIn
from app.schemas.match_requests import CloseMatchRequestIn, MatchRequestAdminOut, MatchRequestPageOut, MatchStatus
from app.services import admin_audit
from app.services import commission as commission_service
from app.services import match_offers as offers_svc
from app.services import notifications as notifications_service

router = APIRouter(prefix="/api/admin/match-requests", tags=["admin"])


def _out(r: dict, offers: list[dict] | None = None) -> MatchRequestAdminOut:
    name = " ".join(part for part in (r["author_first_name"], r["author_last_name"]) if part)
    return MatchRequestAdminOut(
        **{k: r[k] for k in (
            "id", "sport", "goal", "level", "format", "city", "budget_min", "budget_max", "currency", "weekdays", "day_parts",
            "schedule_note", "comment", "status", "created_at", "admin_note", "handled_at",
        )},
        author=PersonOut(id=r["author_id"], name=name, email=r["author_email"]),
        handled_by=r["handled_by_email"],
        offers=[offers_svc.admin_offer_out(o) for o in offers or []],
    )


async def _get(conn: asyncpg.Connection, request_id: UUID) -> MatchRequestAdminOut:
    row = await repo.get_request(conn, request_id)
    if row is None:
        raise NotFoundError("match request not found")
    return _out(row, (await offers_repo.all_for_requests(conn, [request_id])).get(request_id))


@router.get("", response_model=MatchRequestPageOut)
async def list_requests(
    status: MatchStatus | None = None,
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchRequestPageOut:
    total, rows = await repo.list_requests(conn, status=status, query=q, limit=limit, offset=offset)
    offers = await offers_repo.all_for_requests(conn, [r["id"] for r in rows])
    return MatchRequestPageOut(total=total, limit=limit, offset=offset, items=[_out(r, offers.get(r["id"])) for r in rows])


@router.get("/{request_id}", response_model=MatchRequestAdminOut)
async def request_detail(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestAdminOut:
    return await _get(conn, request_id)


@router.post("/{request_id}/take", response_model=MatchRequestAdminOut)
async def take_request(
    request_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestAdminOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await repo.take(conn, request_id, ctx.user["id"]):
                raise NotFoundError("match request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "match_request_take", target_type="match_request", target_id=request_id,
                before={"status": before.status}, after={"status": "in_progress"}, extra={"sport": before.sport},
            )
    except repo.BadTransition as exc:
        raise ConflictError(f"Заявка уже в статусе «{exc.current}».", code="bad_transition") from None
    return await _get(conn, request_id)


@router.post("/{request_id}/close", response_model=MatchRequestAdminOut)
async def close_request(
    request_id: UUID,
    payload: CloseMatchRequestIn,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
) -> MatchRequestAdminOut:
    before = await _get(conn, request_id)
    try:
        async with conn.transaction():
            if not await repo.close(conn, request_id, ctx.user["id"], payload.note):
                raise NotFoundError("match request not found")
            await admin_audit.record(
                conn, ctx.user["id"], "match_request_close", target_type="match_request", target_id=request_id, reason=payload.note,
                before={"status": before.status}, after={"status": "closed"}, extra={"sport": before.sport},
            )
    except repo.BadTransition as exc:
        raise ConflictError(f"Заявка уже обработана (статус «{exc.current}»).", code="bad_transition") from None
    return await _get(conn, request_id)


@router.get("/{request_id}/candidates", response_model=list[CandidateOut])
async def candidates(
    request_id: UUID,
    q: str | None = Query(default=None, max_length=100),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CandidateOut]:
    """Trainers who may be offered this request: opted in, published, no block or history with the athlete. Best matches first."""
    await _get(conn, request_id)
    rows = await offers_repo.candidates(conn, request_id, offers_svc.TERMS_VERSION, query=q)
    return [CandidateOut(**r) for r in rows]


@router.post("/{request_id}/offers", response_model=MatchRequestAdminOut, status_code=201)
async def create_offer(
    request_id: UUID,
    payload: CreateOfferIn,
    ctx: AuthContext = Depends(require_admin_write),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> MatchRequestAdminOut:
    """Offers the athlete to a trainer. The platform's share of the first session is fixed in the offer: the current general setting, or,
    for a finance administrator, a percent chosen for this offer (with a reason, which goes to the audit)."""
    if not settings.payments_enabled:
        # Without the in-app payment the platform would only hand over a client: nothing to take the share from, no contacts to guard.
        raise ConflictError("Онлайн-оплата выключена: предложить тренера нельзя, пока она не включена.", code="payments_unavailable")
    overridden = payload.first_session_percent is not None
    if overridden and not is_finance_admin(ctx.user, settings):
        raise ForbiddenError("only a finance administrator can set the percent of an offer", code="finance_access_required")
    percent = payload.first_session_percent if overridden else await commission_service.first_session_percent(conn, settings)
    try:
        async with conn.transaction():
            offer = await offers_repo.create_offer(
                conn, request_id, payload.coach_user_id, ctx.user["id"], message=payload.message,
                percent=percent, terms_version=offers_svc.TERMS_VERSION, coach_hours=settings.match_coach_reply_hours,
                percent_reason=payload.percent_reason if overridden else None,
            )
            if offer is None:
                raise NotFoundError("match request not found")
            request = await repo.get_request(conn, request_id)
            await admin_audit.record(
                conn, ctx.user["id"], "match_offer_create", target_type="match_request", target_id=request_id,
                after={"offer_id": str(offer["id"]), "coach_user_id": str(payload.coach_user_id),
                       "first_session_percent": float(offer["first_session_percent"])},
                reason=payload.percent_reason if overridden else None,
                extra={"sport": request["sport"], "percent_overridden": overridden},
            )
            await notifications_service.schedule_match_offer_notification(conn, {**offer, "sport": request["sport"]})
    except offers_repo.RequestNotOpen as exc:
        raise ConflictError(f"Заявка уже в статусе «{exc.status}»: предложить тренера нельзя.", code="bad_transition") from None
    except offers_repo.AlreadyOffered:
        raise ConflictError("Этому тренеру эта заявка уже предлагалась.", code="already_offered") from None
    except offers_repo.NotEligible:
        raise ConflictError(
            "Этому тренеру нельзя предложить заявку: он не включил подбор, нет опубликованного объявления, есть блокировка или он уже работает со спортсменом.",
            code="not_eligible",
        ) from None
    except offers_repo.TooManyOffers:
        raise ConflictError(f"Уже {offers_repo.MAX_ACTIVE_PER_REQUEST} предложений ждут ответа. Дождитесь ответов или отзовите лишнее.", code="too_many_offers") from None
    return await _get(conn, request_id)


@router.post("/offers/{offer_id}/withdraw", response_model=MatchRequestAdminOut)
async def withdraw_offer(
    offer_id: UUID, ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db)
) -> MatchRequestAdminOut:
    try:
        async with conn.transaction():
            offer = await offers_repo.withdraw_offer(conn, offer_id)
            if offer is None:
                raise NotFoundError("offer not found")
            await admin_audit.record(
                conn, ctx.user["id"], "match_offer_withdraw", target_type="match_request", target_id=offer["request_id"],
                before={"offer_id": str(offer_id), "status": offer["status"]}, after={"status": "withdrawn"},
            )
    except offers_repo.OfferClosed as exc:
        raise ConflictError(f"Предложение уже в статусе «{exc.status}».", code="offer_closed") from None
    return await _get(conn, offer["request_id"])
