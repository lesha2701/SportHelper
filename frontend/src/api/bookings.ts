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
