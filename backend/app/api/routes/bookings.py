from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.core.exceptions import APIError, ForbiddenError, NotFoundError
from app.repositories import bookings as bookings_repo
from app.repositories import coach_listings as listings_repo
from app.repositories import coach_reviews as coach_reviews_repo
from app.repositories import player_reviews as player_reviews_repo
from app.repositories import plans as plans_repo
from app.repositories import trainings as trainings_repo
from app.schemas.booking import BookingIn, BookingOut, BookingPlanIn, PendingBookingOut, ReviewIn, ReviewOut
from app.services import notifications as notifications_service

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


async def _to_out(conn: asyncpg.Connection, booking: dict) -> BookingOut:
    review = await coach_reviews_repo.get_by_booking(conn, booking["id"])
    player_review = await player_reviews_repo.get_by_booking(conn, booking["id"])
    return BookingOut(
        **booking,
        is_completed=bookings_repo.is_completed(booking),
        has_review=review is not None,
        has_player_review=player_review is not None,
    )


@router.post("", response_model=BookingOut)
async def create_booking(
    payload: BookingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    listing = await listings_repo.get_listing(conn, payload.listing_id)
    if listing is None or not listing["is_listed"]:
        raise NotFoundError("listing not found or not listed")
    if listing["coach_user_id"] == user["id"]:
        raise APIError("cannot book yourself", code="self_booking", status_code=400)
    if payload.format == "online" and not listing["offers_online"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)
    if payload.format == "offline" and not listing["offers_offline"]:
        raise APIError("coach does not offer this format", code="format_not_offered", status_code=400)

    open_slots = await listings_repo.compute_open_slots(
        conn, payload.listing_id, payload.starts_at.date(), payload.starts_at.date()
    )
    if not any(s["starts_at"] == payload.starts_at for s in open_slots):
        raise APIError("slot is not open", code="slot_unavailable", status_code=409)

    booking = await bookings_repo.create_booking(
        conn,
        listing_id=payload.listing_id,
        coach_user_id=listing["coach_user_id"],
        athlete_user_id=user["id"],
        starts_at=payload.starts_at,
        duration_minutes=listing["session_duration_minutes"],
        format=payload.format,
        price_per_session=listing["price_per_session"],
        currency=listing["currency"],
        athlete_notes=payload.athlete_notes,
    )
    if booking is None:
        raise APIError("slot was just booked by someone else", code="slot_unavailable", status_code=409)
    await notifications_service.schedule_booking_requested_notification(conn, booking)
    return await _to_out(conn, booking)


@router.get("/me", response_model=list[BookingOut])
async def list_my_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[BookingOut]:
    bookings = await bookings_repo.list_for_athlete(conn, user["id"])
    return [await _to_out(conn, b) for b in bookings]


@router.get("/coach/pending", response_model=list[PendingBookingOut])
async def list_pending_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[PendingBookingOut]:
    rows = await bookings_repo.list_pending_for_coach(conn, user["id"])
    return [PendingBookingOut(**row) for row in rows]


@router.get("/coach", response_model=list[BookingOut])
async def list_coach_bookings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[BookingOut]:
    bookings = await bookings_repo.list_for_coach(conn, user["id"])
    return [await _to_out(conn, b) for b in bookings]


@router.get("/coach/by-training/{training_id}", response_model=BookingOut)
async def get_coach_booking_by_training(
    training_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    """The caller's own confirmed booking behind a personal training — what
    the coach's session screen needs to offer "Тренировка проведена" and the
    player review. Only ever returns a booking where the caller is the coach."""
    booking = await bookings_repo.get_for_coach_by_training(conn, training_id, user["id"])
    if booking is None:
        raise NotFoundError("no confirmed booking of yours for this training")
    return await _to_out(conn, booking)


@router.patch("/{booking_id}/plan", response_model=BookingOut)
async def set_booking_plan(
    booking_id: UUID,
    payload: BookingPlanIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    """Lets the coach pick which of their own training plans to use for a
    confirmed booking's session — stored on the linked Training, which the
    athlete already sees plan details for when they open it (same as any
    other training with a plan)."""
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only set the plan on your own bookings")
    if booking["training_id"] is None:
        raise APIError("booking has no session yet — confirm it first", code="booking_not_confirmed", status_code=409)
    if payload.plan_id is not None:
        plan = await plans_repo.get_plan(conn, payload.plan_id)
        if plan is None or plan["owner_id"] != user["id"]:
            raise NotFoundError("plan not found")
    await trainings_repo.update_training(conn, booking["training_id"], plan_id=payload.plan_id)
    updated = await bookings_repo.get_booking(conn, booking_id)
    return await _to_out(conn, updated)


@router.post("/{booking_id}/confirm", response_model=BookingOut)
async def confirm_booking(
    booking_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only confirm your own bookings")
    confirmed = await bookings_repo.confirm_booking(conn, booking_id=booking_id, coach_user_id=user["id"])
    if confirmed is None:
        raise APIError("booking is no longer pending", code="booking_not_pending", status_code=409)
    await notifications_service.schedule_booking_decided_notification(conn, confirmed, outcome="confirmed")
    return await _to_out(conn, confirmed)


@router.post("/{booking_id}/decline", response_model=BookingOut)
async def decline_booking(
    booking_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only decline your own bookings")
    declined = await bookings_repo.decline_booking(conn, booking_id=booking_id, coach_user_id=user["id"])
    if declined is None:
        raise APIError("booking is no longer pending", code="booking_not_pending", status_code=409)
    await notifications_service.schedule_booking_decided_notification(conn, declined, outcome="declined")
    return await _to_out(conn, declined)


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
    if review is None:
        raise APIError("this booking already has a review", code="already_reviewed", status_code=409)
    return ReviewOut(**review)


@router.post("/{booking_id}/complete", response_model=BookingOut)
async def complete_booking_session(
    booking_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> BookingOut:
    """The coach marks the session as conducted ("Тренировка проведена"):
    the linked training becomes 'completed', which opens reviews for both
    sides, and the athlete is asked to review the coach. Repeating it is
    harmless and doesn't send a second request."""
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("only the coach of this session can mark it as conducted")
    if booking["status"] != "confirmed" or booking["training_id"] is None:
        raise APIError("only a confirmed booking can be marked as conducted", code="booking_not_confirmed", status_code=409)
    if booking["training_status"] == "completed":
        return await _to_out(conn, booking)
    if booking["training_status"] == "cancelled":
        raise APIError("this session was cancelled", code="session_cancelled", status_code=409)
    if booking["starts_at"] > datetime.now(timezone.utc):
        raise APIError("the session has not started yet", code="session_not_started", status_code=409)

    await trainings_repo.update_training(conn, booking["training_id"], status="completed")
    updated = await bookings_repo.get_booking(conn, booking_id)
    await notifications_service.schedule_review_requested_notification(conn, updated)
    return await _to_out(conn, updated)


@router.post("/{booking_id}/player-review", response_model=ReviewOut)
async def review_player(
    booking_id: UUID,
    payload: ReviewIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> ReviewOut:
    """The coach's review of the athlete after a conducted session. Visible to
    coaches who have a booking with that athlete (see players.py)."""
    booking = await bookings_repo.get_booking(conn, booking_id)
    if booking is None:
        raise NotFoundError("booking not found")
    if booking["coach_user_id"] != user["id"]:
        raise ForbiddenError("you can only review athletes you trained yourself")
    if not bookings_repo.is_completed(booking):
        raise APIError("booking is not completed yet", code="booking_not_completed", status_code=409)
    if await player_reviews_repo.get_by_booking(conn, booking_id) is not None:
        raise APIError("this booking already has a review", code="already_reviewed", status_code=409)

    review = await player_reviews_repo.create_review(
        conn,
        booking_id=booking_id,
        coach_user_id=user["id"],
        athlete_user_id=booking["athlete_user_id"],
        rating=payload.rating,
        text=payload.text,
    )
    if review is None:
        raise APIError("this booking already has a review", code="already_reviewed", status_code=409)
    return ReviewOut(**review)
