from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.core.session_time import WALL_CLOCK_DOC


class BookingIn(BaseModel):
    listing_id: UUID
    starts_at: datetime = Field(description=WALL_CLOCK_DOC)
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
    free_cancel_until: datetime | None = Field(description=WALL_CLOCK_DOC)
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


class SessionConfirmationOut(BaseModel):
    """Whether the session took place, as one side of the booking sees it, and what that side can do now."""

    state: Literal["scheduled", "awaiting", "confirmed", "auto_confirmed", "disputed", "resolved_released", "resolved_refunded"]
    window_closes_at: datetime  # when the background pass confirms it by itself (48 hours after the end) unless someone disputes
    coach_marked_at: datetime | None = None
    confirmed_at: datetime | None = None
    confirmed_method: Literal["athlete", "code", "auto"] | None = None
    disputed_by_role: Literal["athlete", "coach"] | None = None
    dispute_kind: Literal["athlete_no_show", "coach_no_show", "not_conducted", "other"] | None = None
    dispute_text: str | None = None
    resolved_at: datetime | None = None
    can_confirm: bool = False
    can_report_problem: bool = False
    can_get_code: bool = False
    can_enter_code: bool = False


class SessionCodeOut(BaseModel):
    """The athlete's one-time code: shown once; asking again issues a new one and this one stops working."""

    code: str
    expires_at: datetime


class SessionCodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)


class SessionProblemIn(BaseModel):
    kind: Literal["athlete_no_show", "coach_no_show", "not_conducted", "other"]
    text: str | None = Field(default=None, max_length=1000)


class BookingOut(BaseModel):
    id: UUID
    coach_user_id: UUID
    coach_full_name: str
    listing_id: UUID | None
    listing_title: str | None
    athlete_user_id: UUID
    athlete_full_name: str
    athlete_notes: str | None
    starts_at: datetime = Field(description=WALL_CLOCK_DOC)
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
    # The session's start has come on the platform's clock (SESSION_TIMEZONE). «Тренировка проведена» is offered by this, not by
    # comparing starts_at with the device's clock: starts_at is the session's wall-clock time with a UTC label, not a real instant.
    has_started: bool = Field(default=False, description="The session's start has come on the platform's clock.")
    cancellation: CancellationOut | None = None
    # confirming that the session took place (docs/session-confirmation.md); None until the booking is confirmed or after it is cancelled
    session_confirmation: SessionConfirmationOut | None = None


class PaymentStartOut(BaseModel):
    """Where to send the customer to pay (ЮKassa's payment page)."""

    confirmation_url: str


class PendingBookingOut(BaseModel):
    id: UUID
    listing_title: str | None
    athlete_user_id: UUID
    athlete_full_name: str
    athlete_notes: str | None
    starts_at: datetime = Field(description=WALL_CLOCK_DOC)
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
