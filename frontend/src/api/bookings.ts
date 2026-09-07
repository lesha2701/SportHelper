// frontend/src/api/bookings.ts
import { apiRequest } from "./client";
import { mapBookingDto, type Booking, type BookingDto, type BookingInput, type ReviewDto, type ReviewInput } from "../types/booking";

export async function createBooking(token: string, input: BookingInput): Promise<Booking> {
  const dto = await apiRequest<BookingDto>("/api/bookings", { method: "POST", token, body: input });
  return mapBookingDto(dto);
}

export async function listMyBookings(token: string): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/me", { token });
  return dtos.map(mapBookingDto);
}

export async function reviewBooking(token: string, bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/reviews`, { method: "POST", token, body: input });
}
