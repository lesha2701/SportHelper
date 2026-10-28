import { apiRequest } from "./client";
import { mapBookingDto, type Booking, type BookingDto } from "../types/booking";

/** The athlete pressed «Оплатить эту тренировку»: the server returns the ЮKassa page to send them to. */
export async function startBookingPayment(token: string, bookingId: string): Promise<{ confirmationUrl: string }> {
  const dto = await apiRequest<{ confirmation_url: string }>(`/api/bookings/${bookingId}/pay`, { method: "POST", token, silent: true });
  return { confirmationUrl: dto.confirmation_url };
}

/** Asks the server to check with the payment service how the booking's payment ended. */
export async function syncBookingPayment(token: string, bookingId: string): Promise<Booking> {
  return mapBookingDto(await apiRequest<BookingDto>(`/api/bookings/${bookingId}/payment/sync`, { method: "POST", token, silent: true }));
}

/** Leaves the site for the payment page (a seam so tests do not navigate). */
export function openPaymentPage(url: string): void {
  window.location.assign(url);
}
