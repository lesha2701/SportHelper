// frontend/src/types/booking.ts

export type BookingStatus = "pending" | "confirmed" | "declined" | "expired" | "cancelled";

export interface BookingDto {
  id: string;
  coach_user_id: string;
  coach_full_name: string;
  athlete_user_id: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  status: BookingStatus;
  is_completed: boolean;
  training_id: string | null;
  has_review: boolean;
}

export interface Booking {
  id: string;
  coachUserId: string;
  coachFullName: string;
  athleteUserId: string;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  status: BookingStatus;
  isCompleted: boolean;
  trainingId: string | null;
  hasReview: boolean;
}

export function mapBookingDto(dto: BookingDto): Booking {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    athleteUserId: dto.athlete_user_id,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    status: dto.status,
    isCompleted: dto.is_completed,
    trainingId: dto.training_id,
    hasReview: dto.has_review,
  };
}

export interface BookingInput {
  coach_user_id: string;
  starts_at: string;
  format: "online" | "offline";
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
  athlete_user_id: string;
  athlete_full_name: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  created_at: string;
}

export interface PendingBooking {
  id: string;
  athleteUserId: string;
  athleteFullName: string;
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
    athleteUserId: dto.athlete_user_id,
    athleteFullName: dto.athlete_full_name,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    createdAt: dto.created_at,
  };
}
