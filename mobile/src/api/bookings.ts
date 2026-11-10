// frontend/src/api/bookings.ts
import { apiRequest } from "./client";
import { mapBookingDto, mapPendingBookingDto, type Booking, type BookingDto, type BookingInput, type PendingBooking, type PendingBookingDto, type ReviewDto, type ReviewInput } from "@/shared/types/booking";

export async function createBooking(input: BookingInput): Promise<Booking> {
  const dto = await apiRequest<BookingDto>("/api/bookings", { method: "POST", successMessage: "Заявка отправлена тренеру", body: input });
  return mapBookingDto(dto);
}

export async function listMyBookings(): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/me");
  return dtos.map(mapBookingDto);
}

export async function reviewBooking(bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/reviews`, { method: "POST", successMessage: "Отзыв отправлен", body: input });
}

/** The coach marks the session as conducted: opens reviews for both sides and
 * asks the athlete to review the coach. */
export async function completeBookingSession(bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/complete`, {
    method: "POST",
    successMessage: "Тренировка отмечена проведённой. Игроку отправлен запрос на отзыв.",
  });
  return mapBookingDto(dto);
}

/** The coach's review of the athlete (shown to other coaches the athlete books with). */
export async function reviewPlayer(bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/player-review`, {
    method: "POST",
    body: input,
    successMessage: "Отзыв об игроке сохранён",
  });
}

/** The caller's own confirmed booking behind a personal training (they must be its coach). */
export async function getCoachBookingByTraining(trainingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/coach/by-training/${trainingId}`);
  return mapBookingDto(dto);
}

export async function listCoachPendingBookings(): Promise<PendingBooking[]> {
  const dtos = await apiRequest<PendingBookingDto[]>("/api/bookings/coach/pending");
  return dtos.map(mapPendingBookingDto);
}

export async function listCoachBookings(): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/coach");
  return dtos.map(mapBookingDto);
}

export async function confirmBooking(bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/confirm`, { method: "POST", successMessage: "Запись подтверждена" });
  return mapBookingDto(dto);
}

export async function declineBooking(bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/decline`, { method: "POST", successMessage: "Заявка отклонена" });
  return mapBookingDto(dto);
}

export async function setBookingPlan(bookingId: string, planId: string | null): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/plan`, {
    method: "PATCH", successMessage: "План привязан к тренировке",
    body: { plan_id: planId },
  });
  return mapBookingDto(dto);
}
