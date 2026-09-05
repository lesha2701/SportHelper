from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import coach_marketplace as marketplace_repo
from app.repositories import coach_reviews as coach_reviews_repo
from app.schemas.booking import BookingIn, BookingOut, ReviewIn, ReviewOut

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


async def _to_out(conn: asyncpg.Connection, booking: dict) -> BookingOut:
    review = await coach_reviews_repo.get_by_booking(conn, booking["id"])
    return BookingOut(
        **booking,
        is_completed=bookings_repo.is_completed(booking),
        has_review=review is not None,
    )


@router.post("", response_model=BookingOut)
async def create_booking(
    payload: BookingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    if payload.coach_user_id == user["id"]:
        raise APIError("cannot book yourself", code="self_booking", status_code=400)

    settings = await marketplace_repo.get_settings(conn, payload.coach_user_id)
    if settings is None or not settings["is_listed"]:
        raise NotFoundError("coach not found or not listed")
    if payload.format == "online" and not settings["offers_online"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)
    if payload.format == "offline" and not settings["offers_offline"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)

    open_slots = await marketplace_repo.compute_open_slots(
        conn, payload.coach_user_id, payload.starts_at.date(), payload.starts_at.date()
    )
    if not any(s["starts_at"] == payload.starts_at.replace(tzinfo=None) for s in open_slots):
        raise APIError("slot is not open", code="slot_unavailable", status_code=409)

    booking = await bookings_repo.create_booking(
        conn,
        coach_user_id=payload.coach_user_id,
        athlete_user_id=user["id"],
        starts_at=payload.starts_at,
        duration_minutes=settings["session_duration_minutes"],
        format=payload.format,
        price_per_session=settings["price_per_session"],
        currency=settings["currency"],
        location=settings["location"],
    )
    if booking is None:
        raise APIError("slot was just booked by someone else", code="slot_unavailable", status_code=409)
    return await _to_out(conn, booking)


@router.get("/me", response_model=list[BookingOut])
async def list_my_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[BookingOut]:
    bookings = await bookings_repo.list_for_athlete(conn, user["id"])
    return [await _to_out(conn, b) for b in bookings]


@router.post("/{booking_id}/reviews", response_model=ReviewOut)
async def review_booking(
    booking_id: UUID,
    payload: ReviewIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReviewOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["athlete_user_id"] != user["id"]:
        raise ForbiddenError("you can only review your own bookings")
    if not bookings_repo.is_completed(booking):
        raise APIError("booking is not completed yet", code="booking_not_completed", status_code=409)
    if await coach_reviews_repo.get_by_booking(conn, booking_id) is not None:
        raise APIError("this booking already has a review", code="already_reviewed", status_code=409)

    review = await coach_reviews_repo.create_review(
        conn,
        booking_id=booking_id,
        coach_user_id=booking["coach_user_id"],
        athlete_user_id=user["id"],
        rating=payload.rating,
        text=payload.text,
    )
    return ReviewOut(**review)
