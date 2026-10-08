// frontend/src/api/bookings.ts
import { apiRequest } from "./client";
import { mapBookingDto, mapPendingBookingDto, type Booking, type BookingDto, type BookingInput, type PendingBooking, type PendingBookingDto, type ReviewDto, type ReviewInput } from "../types/booking";

export async function createBooking(token: string, input: BookingInput): Promise<Booking> {
  const dto = await apiRequest<BookingDto>("/api/bookings", { method: "POST", successMessage: "Заявка отправлена тренеру", token, body: input });
  return mapBookingDto(dto);
}

export async function listMyBookings(token: string): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/me", { token });
  return dtos.map(mapBookingDto);
}

export async function reviewBooking(token: string, bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/reviews`, { method: "POST", successMessage: "Отзыв отправлен", token, body: input });
}

/** The coach marks the session as conducted: opens reviews for both sides and
 * asks the athlete to review the coach. */
export async function completeBookingSession(token: string, bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/complete`, {
    method: "POST",
    token,
    successMessage: "Тренировка отмечена проведённой. Игроку отправлен запрос на отзыв.",
  });
  return mapBookingDto(dto);
}

/** The coach's review of the athlete (shown to other coaches the athlete books with). */
export async function reviewPlayer(token: string, bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/player-review`, {
    method: "POST",
    token,
    body: input,
    successMessage: "Отзыв об игроке сохранён",
  });
}

/** The caller's own confirmed booking behind a personal training (they must be its coach). */
export async function getCoachBookingByTraining(token: string, trainingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/coach/by-training/${trainingId}`, { token });
  return mapBookingDto(dto);
}

export async function listCoachPendingBookings(token: string): Promise<PendingBooking[]> {
  const dtos = await apiRequest<PendingBookingDto[]>("/api/bookings/coach/pending", { token });
  return dtos.map(mapPendingBookingDto);
}

export async function listCoachBookings(token: string): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/coach", { token });
  return dtos.map(mapBookingDto);
}

export async function confirmBooking(token: string, bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/confirm`, { method: "POST", successMessage: "Запись подтверждена", token });
  return mapBookingDto(dto);
}

export async function declineBooking(token: string, bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/decline`, { method: "POST", successMessage: "Заявка отклонена", token });
  return mapBookingDto(dto);
}

export async function setBookingPlan(token: string, bookingId: string, planId: string | null): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/plan`, {
    method: "PATCH", successMessage: "План привязан к тренировке",
    token,
    body: { plan_id: planId },
  });
  return mapBookingDto(dto);
}
