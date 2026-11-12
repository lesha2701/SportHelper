// frontend/src/api/bookings.ts
import { apiRequest } from "./client";
import {
  mapBookingDto,
  mapCancelPreviewDto,
  mapPendingBookingDto,
  type Booking,
  type BookingDto,
  type BookingInput,
  type CancelPreview,
  type CancelPreviewDto,
  type PendingBooking,
  type PendingBookingDto,
  type ReviewDto,
  type ReviewInput,
  type SessionCode,
  type SessionProblemKind,
} from "@/shared/types/booking";

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

/** What cancelling the booking right now would mean: «Вернём 100%» or «Деньги не вернутся». Changes nothing. */
export async function getCancelPreview(bookingId: string): Promise<CancelPreview> {
  const dto = await apiRequest<CancelPreviewDto>(`/api/bookings/${bookingId}/cancel-preview`);
  return mapCancelPreviewDto(dto);
}

/** Cancels a confirmed booking by the agreed rule; the money goes back by itself. The coach has to give a reason. */
export async function cancelBooking(bookingId: string, reason: string | null): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    successMessage: "Запись отменена",
    body: { reason },
  });
  return mapBookingDto(dto);
}

// --- confirming that the session took place (docs/session-confirmation.md) ---

/** The athlete confirms that the session took place (after its end). */
export async function confirmSession(bookingId: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/session/confirm`, { method: "POST", successMessage: "Тренировка подтверждена" });
  return mapBookingDto(dto);
}

/** A new one-time code for an in-person session (the athlete shows it to the coach). Asking again replaces the previous code. */
export async function getSessionCode(bookingId: string): Promise<SessionCode> {
  const dto = await apiRequest<{ code: string; expires_at: string }>(`/api/bookings/${bookingId}/session/code`, { method: "POST" });
  return { code: dto.code, expiresAt: dto.expires_at };
}

/** The coach enters the athlete's code. */
export async function verifySessionCode(bookingId: string, code: string): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/session/code/verify`, {
    method: "POST",
    body: { code },
    successMessage: "Код принят — тренировка подтверждена",
  });
  return mapBookingDto(dto);
}

/** Either side reports a problem with the session; the money waits for an administrator. */
export async function reportSessionProblem(bookingId: string, kind: SessionProblemKind, text: string | null): Promise<Booking> {
  const dto = await apiRequest<BookingDto>(`/api/bookings/${bookingId}/session/problem`, {
    method: "POST",
    body: { kind, text },
    successMessage: "Сообщение отправлено администратору",
  });
  return mapBookingDto(dto);
}
