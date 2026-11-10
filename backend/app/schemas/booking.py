from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class BookingIn(BaseModel):
    listing_id: UUID
    starts_at: datetime
    format: str  # "online" | "offline"
    athlete_notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _normalize_starts_at_to_utc(self) -> "BookingIn":
        # bookings.starts_at is a real TIMESTAMPTZ column, so the whole
        # booking pipeline (slot lookup, double-booking guard, INSERT) must
        # agree on one timezone-aware representation. A naive input is
        # assumed to already be UTC (this repo's usual "naive means UTC"
        # convention); an aware input with a different offset is converted.
        # Without this, two requests for the "same" wall-clock slot but
        # different UTC offsets would insert two different starts_at values
        # and slip past the UNIQUE (coach_user_id, starts_at) guard.
        if self.starts_at.tzinfo is None:
            self.starts_at = self.starts_at.replace(tzinfo=timezone.utc)
        else:
            self.starts_at = self.starts_at.astimezone(timezone.utc)
        return self


class CancellationOut(BaseModel):
    """Who cancelled the booking, why, by which rule and what happened to the money (None on the booking until it is cancelled)."""

    cancelled_by_role: str  # athlete | coach
    cancelled_at: datetime
    reason: str | None = None
    policy: str  # unpaid | athlete_early | athlete_late | coach
    refund_percent: int
    refund_amount_kopecks: int
    # none (nothing to return) | pending (waits for ЮKassa) | succeeded | failed (the administrator decides by hand)
    refund_status: str


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class CancelPreviewOut(BaseModel):
    """What cancelling the booking right now would mean; changes nothing."""

    booking_id: UUID
    cancelled_by_role: str
    policy: str
    hours_before_start: float
    free_cancel_until: datetime | None
    paid_kopecks: int
    refund_percent: int
    refund_kopecks: int
    trainer_keeps_payment: bool


class BookingMoneyPaymentOut(BaseModel):
    status: str  # awaiting | paid | partially_refunded | refunded
    gross_kopecks: int
    paid_at: datetime | None = None
    # the trainer's side only
    trainer_kopecks: int | None = None
    platform_fee_kopecks: int | None = None


class BookingMoneyRefundOut(BaseModel):
    id: UUID
    amount_kopecks: int
    status: str  # pending | succeeded | failed
    source: str  # cancellation | automatic | administrator
    reason: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    # the trainer's side only
    trainer_refund_kopecks: int | None = None


class BookingMoneyOut(BaseModel):
    """The payment and the refunds of one booking (the same for the athlete and the trainer, except the trainer's own share)."""

    booking_id: UUID
    viewer_role: str  # athlete | coach
    currency: str
    payment: BookingMoneyPaymentOut | None
    refunds: list[BookingMoneyRefundOut]
    refunded_kopecks: int
    cancelled_at: datetime | None = None
    cancellation_policy: str | None = None


class BookingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    coach_full_name: str
    listing_id: UUID | None
    listing_title: str | None
    athlete_user_id: UUID
    athlete_full_name: str
    athlete_notes: str | None
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    status: str
    is_completed: bool
    training_id: UUID | None
    training_plan_id: UUID | None
    training_plan_name: str | None
    # "scheduled" / "completed" / "cancelled" of the linked session (None while pending).
    training_status: str | None = None
    has_review: bool
    # The coach's review of the athlete exists (only meaningful for the coach).
    has_player_review: bool = False
    # not_required (free) | unpaid | pending (a payment page is open) | paid
    payment_status: str = "unpaid"
    paid_at: datetime | None = None
    # The «Отменить» button is shown by this: the booking is confirmed and its session has not started, was not conducted and was not cancelled.
    can_cancel: bool = False
    cancellation: CancellationOut | None = None


class PaymentStartOut(BaseModel):
    """Where to send the customer to pay (ЮKassa's payment page)."""

    confirmation_url: str


class PendingBookingOut(BaseModel):
    id: UUID
    listing_title: str | None
    athlete_user_id: UUID
    athlete_full_name: str
    athlete_notes: str | None
    starts_at: datetime
    duration_minutes: int
    format: str
    price_per_session: float | None
    currency: str
    created_at: datetime
    # How other coaches rated this athlete; None/0 while they have no reviews.
    athlete_rating_average: float | None = None
    athlete_review_count: int = 0


class BookingPlanIn(BaseModel):
    plan_id: UUID | None = None


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=2000)


class ReviewOut(BaseModel):
    id: UUID
    booking_id: UUID
    rating: int
    text: str | None


class PlayerReviewOut(BaseModel):
    id: UUID
    coach_name: str
    rating: int
    text: str | None
    created_at: datetime


class PlayerReviewsOut(BaseModel):
    average: float | None
    count: int
    reviews: list[PlayerReviewOut]
