"""Trainings (read-only) and coach listings (moderation) for administrators with the second factor."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.api.deps import AuthContext, get_db, require_admin_mfa, require_admin_recent_mfa
from app.core.exceptions import ConflictError, NotFoundError
from app.repositories import admin_content as content_repo
from app.schemas.admin import (
    ConfirmedReasonIn,
    ListingDetailOut,
    ListingRowOut,
    ListingsPageOut,
    PersonOut,
    ReasonIn,
    TrainingBookingOut,
    TrainingDetailOut,
    TrainingParticipantOut,
    TrainingRowOut,
    TrainingsPageOut,
)
from app.services import admin_audit

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _name(first: str | None, last: str | None) -> str:
    return " ".join(part for part in (first, last) if part)


# --- trainings (read-only) ------------------------------------------------------------------------------------------


def _training_row(r: dict) -> dict:
    description = r["description"]
    return {
        "id": r["id"],
        "type": r["type"],
        "status": r["status"],
        "training_date": r["training_date"],
        "start_time": r["start_time"],
        "duration_minutes": r["duration_minutes"],
        "location": r["location"],
        "description": description if description is None or len(description) <= 160 else description[:160] + "…",
        "team": {"id": str(r["team_id"]), "name": r["team_name"]} if r["team_id"] else None,
        "creator": PersonOut(id=r["creator_id"], name=_name(r["creator_first_name"], r["creator_last_name"]), email=r["creator_email"]),
        "participants": r["participants"],
        "bookings": r["bookings"],
        "created_at": r["created_at"],
    }


@router.get("/trainings", response_model=TrainingsPageOut)
async def list_trainings(
    q: str | None = Query(default=None, max_length=100),
    status: Literal["scheduled", "completed", "cancelled"] | None = None,
    type: Literal["team", "personal", "independent"] | None = None,
    when: Literal["upcoming", "past"] | None = None,
    sort: Literal["date_desc", "date_asc"] = "date_desc",
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> TrainingsPageOut:
    total, rows = await content_repo.list_trainings(
        conn, query=q, status=status, kind=type, when=when, sort=sort, limit=limit, offset=offset
    )
    return TrainingsPageOut(total=total, limit=limit, offset=offset, items=[TrainingRowOut(**_training_row(r)) for r in rows])


@router.get("/trainings/{training_id}", response_model=TrainingDetailOut)
async def training_detail(
    training_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> TrainingDetailOut:
    r = await content_repo.get_training(conn, training_id)
    if r is None:
        raise NotFoundError("training not found")
    row = _training_row(r)
    row["description"] = r["description"]  # the detail shows the whole text
    return TrainingDetailOut(
        **row,
        plan_name=r["plan_name"],
        reminder_minutes_before=r["reminder_minutes_before"],
        recurring=r["recurrence_group_id"] is not None,
        participant_list=[
            TrainingParticipantOut(id=p["id"], name=_name(p["first_name"], p["last_name"]), attendance=p["status"]) for p in r["participant_list"]
        ],
        booking_list=[
            TrainingBookingOut(
                id=b["id"], status=b["status"], starts_at=b["starts_at"], format=b["format"],
                coach=_name(b["coach_first_name"], b["coach_last_name"]), athlete=_name(b["athlete_first_name"], b["athlete_last_name"]),
            )
            for b in r["booking_list"]
        ],
    )


# --- listings --------------------------------------------------------------------------------------------------------


def _listing_state(r: dict) -> str:
    if r["deleted_at"] is not None:
        return "deleted"
    if r["moderation_hidden_at"] is not None:
        return "hidden"
    return "public" if r["is_listed"] and not r["coach_blocked"] else "unlisted"


def _listing_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "coach": PersonOut(id=r["coach_id"], name=_name(r["coach_first_name"], r["coach_last_name"]), email=r["coach_email"]),
        "coach_blocked": r["coach_blocked"],
        "price_per_session": float(r["price_per_session"]) if r["price_per_session"] is not None else None,
        "currency": r["currency"],
        "location": r["location"],
        "state": _listing_state(r),
        "moderation_reason": r["moderation_reason"],
        "hidden_by": r["hidden_by_email"],
        "hidden_at": r["moderation_hidden_at"],
        "active_bookings": r["active_bookings"],
        "has_photo": r["has_photo"],
        "has_video": r["has_video"],
        "created_at": r["created_at"],
    }


async def _listing_detail(conn: asyncpg.Connection, listing_id: UUID) -> ListingDetailOut:
    r = await content_repo.get_listing(conn, listing_id)
    if r is None:
        raise NotFoundError("listing not found")
    return ListingDetailOut(**_listing_row(r), description=r["description"], open_complaints=r["open_complaints"])


@router.get("/listings", response_model=ListingsPageOut)
async def list_listings(
    q: str | None = Query(default=None, max_length=100),
    state: Literal["public", "hidden", "unlisted", "deleted"] | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    ctx: AuthContext = Depends(require_admin_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> ListingsPageOut:
    total, rows = await content_repo.list_listings(conn, query=q, state=state, limit=limit, offset=offset)
    return ListingsPageOut(total=total, limit=limit, offset=offset, items=[ListingRowOut(**_listing_row(r)) for r in rows])


@router.get("/listings/{listing_id}", response_model=ListingDetailOut)
async def listing_detail(
    listing_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> ListingDetailOut:
    return await _listing_detail(conn, listing_id)


def _listing_snapshot(listing: ListingDetailOut) -> dict:
    return {"state": listing.state, "title": listing.title, "coach": str(listing.coach.id), "active_bookings": listing.active_bookings}


async def _moderate_listing(listing_id: UUID, hide: bool, reason: str, ctx: AuthContext, conn: asyncpg.Connection) -> ListingDetailOut:
    before = await _listing_detail(conn, listing_id)
    if before.state == "deleted":
        raise NotFoundError("listing not found")
    try:
        async with conn.transaction():
            if not await content_repo.set_listing_hidden(conn, listing_id, ctx.user["id"], hide, reason):
                raise NotFoundError("listing not found")
            after = await _listing_detail(conn, listing_id)
            await admin_audit.record(
                conn, ctx.user["id"], "listing_hide" if hide else "listing_restore", target_type="listing", target_id=listing_id,
                reason=reason, before=_listing_snapshot(before), after=_listing_snapshot(after),
            )
    except content_repo.ListingWrongState:
        raise ConflictError(
            "Объявление уже скрыто." if hide else "Объявление не скрыто модератором.", code="already_hidden" if hide else "not_hidden"
        ) from None
    return after


@router.post("/listings/{listing_id}/hide", response_model=ListingDetailOut)
async def hide_listing(
    listing_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> ListingDetailOut:
    """Takes it out of the catalogue, search, the coach's public profile and booking. Sessions already booked stay as they are."""
    return await _moderate_listing(listing_id, True, payload.reason, ctx, conn)


@router.post("/listings/{listing_id}/restore", response_model=ListingDetailOut)
async def restore_listing(
    listing_id: UUID, payload: ReasonIn, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)
) -> ListingDetailOut:
    return await _moderate_listing(listing_id, False, payload.reason, ctx, conn)


@router.post("/listings/{listing_id}/delete", response_model=ListingDetailOut)
async def delete_listing(
    listing_id: UUID,
    payload: ConfirmedReasonIn,
    ctx: AuthContext = Depends(require_admin_recent_mfa),
    conn: asyncpg.Connection = Depends(get_db),
) -> ListingDetailOut:
    """Deletes (soft, like the coach's own delete) - but not while a request is pending or a confirmed session is still ahead:
    nobody who booked is left without their session. Hide the listing instead, then deal with those bookings."""
    before = await _listing_detail(conn, listing_id)
    if before.state == "deleted":
        raise NotFoundError("listing not found")
    try:
        async with conn.transaction():
            if not await content_repo.delete_listing(conn, listing_id):
                raise NotFoundError("listing not found")
            after = await _listing_detail(conn, listing_id)
            await admin_audit.record(
                conn, ctx.user["id"], "listing_delete", target_type="listing", target_id=listing_id, reason=payload.reason,
                before=_listing_snapshot(before), after=_listing_snapshot(after),
            )
    except content_repo.HasActiveBookings:
        await admin_audit.record(
            conn, ctx.user["id"], "listing_delete", target_type="listing", target_id=listing_id, reason=payload.reason,
            before=_listing_snapshot(before), result="denied", extra={"why": "active bookings"},
        )
        raise ConflictError(
            "У объявления есть заявки или будущие записи. Скройте его, а записи завершите или отмените по обычным правилам.",
            code="has_active_bookings",
        ) from None
    return after
