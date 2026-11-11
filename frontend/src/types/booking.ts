// frontend/src/types/booking.ts

/** not_required: a free session; unpaid: waiting for payment; processing: a payment page is open; paid; canceled: the last try ended
 * without payment; refund_pending / refunded: the money is coming back (or has). */
export type PaymentStatus = "not_required" | "unpaid" | "processing" | "paid" | "canceled" | "refund_pending" | "refunded";

export type BookingStatus = "pending" | "confirmed" | "declined" | "expired" | "cancelled";

/** Who cancelled, by which rule, and what happens to the money. none: nothing to return; pending: waits for the bank;
 * succeeded: returned; failed: the bank refused, an administrator decides by hand. */
export type RefundStatus = "none" | "pending" | "succeeded" | "failed";
export type CancelPolicy = "unpaid" | "athlete_early" | "athlete_late" | "coach";

export interface CancellationDto {
  cancelled_by_role: "athlete" | "coach";
  cancelled_at: string;
  reason: string | null;
  policy: CancelPolicy;
  refund_percent: number;
  refund_amount_kopecks: number;
  refund_status: RefundStatus;
}

export interface Cancellation {
  cancelledByRole: "athlete" | "coach";
  cancelledAt: string;
  reason: string | null;
  policy: CancelPolicy;
  refundPercent: number;
  refundAmountKopecks: number;
  refundStatus: RefundStatus;
}

export interface CancelPreviewDto {
  booking_id: string;
  cancelled_by_role: "athlete" | "coach";
  policy: CancelPolicy;
  hours_before_start: number;
  free_cancel_until: string | null;
  paid_kopecks: number;
  refund_percent: number;
  refund_kopecks: number;
  trainer_keeps_payment: boolean;
}

/** What cancelling the booking right now would mean (nothing is changed by asking). */
export interface CancelPreview {
  policy: CancelPolicy;
  hoursBeforeStart: number;
  freeCancelUntil: string | null;
  paidKopecks: number;
  refundPercent: number;
  refundKopecks: number;
  trainerKeepsPayment: boolean;
}

export function mapCancelPreviewDto(dto: CancelPreviewDto): CancelPreview {
  return {
    policy: dto.policy,
    hoursBeforeStart: dto.hours_before_start,
    freeCancelUntil: dto.free_cancel_until,
    paidKopecks: dto.paid_kopecks,
    refundPercent: dto.refund_percent,
    refundKopecks: dto.refund_kopecks,
    trainerKeepsPayment: dto.trainer_keeps_payment,
  };
}

export interface BookingDto {
  id: string;
  coach_user_id: string;
  coach_full_name: string;
  listing_id: string | null;
  listing_title: string | null;
  athlete_user_id: string;
  athlete_full_name: string;
  athlete_notes: string | null;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  status: BookingStatus;
  is_completed: boolean;
  training_id: string | null;
  training_plan_id: string | null;
  training_plan_name: string | null;
  training_status: "scheduled" | "completed" | "cancelled" | null;
  has_review: boolean;
  has_player_review: boolean;
  payment_status?: PaymentStatus;
  paid_at?: string | null;
  can_cancel?: boolean;
  has_started?: boolean;
  cancellation?: CancellationDto | null;
}

export interface Booking {
  id: string;
  coachUserId: string;
  coachFullName: string;
  listingId: string | null;
  listingTitle: string | null;
  athleteUserId: string;
  athleteFullName: string;
  athleteNotes: string | null;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  status: BookingStatus;
  isCompleted: boolean;
  trainingId: string | null;
  trainingPlanId: string | null;
  trainingPlanName: string | null;
  /** Status of the linked session; "completed" once the coach marked it conducted. */
  trainingStatus: "scheduled" | "completed" | "cancelled" | null;
  hasReview: boolean;
  /** The coach has already reviewed the player (coach side only). */
  hasPlayerReview: boolean;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  /** The «Отменить» button is shown by this: confirmed, not started, not conducted, not cancelled. */
  canCancel: boolean;
  /** The session's start has come on the platform's clock (the server decides: startsAt is the session's wall-clock time
   * with a UTC label, not a real instant, so it must not be compared with the device's clock). */
  hasStarted: boolean;
  /** Set once the booking is cancelled. */
  cancellation: Cancellation | null;
}

export function mapBookingDto(dto: BookingDto): Booking {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    listingId: dto.listing_id,
    listingTitle: dto.listing_title,
    athleteUserId: dto.athlete_user_id,
    athleteFullName: dto.athlete_full_name,
    athleteNotes: dto.athlete_notes,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    status: dto.status,
    isCompleted: dto.is_completed,
    trainingId: dto.training_id,
    trainingPlanId: dto.training_plan_id,
    trainingPlanName: dto.training_plan_name,
    trainingStatus: dto.training_status ?? null,
    hasReview: dto.has_review,
    hasPlayerReview: dto.has_player_review ?? false,
    paymentStatus: dto.payment_status ?? "not_required",
    paidAt: dto.paid_at ?? null,
    canCancel: dto.can_cancel ?? false,
    hasStarted: dto.has_started ?? false,
    cancellation: dto.cancellation
      ? {
          cancelledByRole: dto.cancellation.cancelled_by_role,
          cancelledAt: dto.cancellation.cancelled_at,
          reason: dto.cancellation.reason,
          policy: dto.cancellation.policy,
          refundPercent: dto.cancellation.refund_percent,
          refundAmountKopecks: dto.cancellation.refund_amount_kopecks,
          refundStatus: dto.cancellation.refund_status,
        }
      : null,
  };
}

export interface BookingInput {
  listing_id: string;
  starts_at: string;
  format: "online" | "offline";
  athlete_notes: string | null;
}

export interface ReviewInput {
  rating: number;
  text: string | null;
}

export interface ReviewDto {
  id: string;
  booking_id: string;
  rating: number;
  text: string | null;
}

export interface PendingBookingDto {
  id: string;
  listing_title: string | null;
  athlete_user_id: string;
  athlete_full_name: string;
  athlete_notes: string | null;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  created_at: string;
  athlete_rating_average: number | null;
  athlete_review_count: number;
}

export interface PendingBooking {
  id: string;
  listingTitle: string | null;
  athleteUserId: string;
  athleteFullName: string;
  athleteNotes: string | null;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  createdAt: string;
  /** How other coaches rated this athlete (null while nobody has). */
  athleteRatingAverage: number | null;
  athleteReviewCount: number;
}

export function mapPendingBookingDto(dto: PendingBookingDto): PendingBooking {
  return {
    id: dto.id,
    listingTitle: dto.listing_title,
    athleteUserId: dto.athlete_user_id,
    athleteFullName: dto.athlete_full_name,
    athleteNotes: dto.athlete_notes,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    createdAt: dto.created_at,
    athleteRatingAverage: dto.athlete_rating_average ?? null,
    athleteReviewCount: dto.athlete_review_count ?? 0,
  };
}
