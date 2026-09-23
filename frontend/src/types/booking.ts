// frontend/src/types/booking.ts

export type BookingStatus = "pending" | "confirmed" | "declined" | "expired" | "cancelled";

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
  has_review: boolean;
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
  hasReview: boolean;
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
    hasReview: dto.has_review,
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
  };
}
