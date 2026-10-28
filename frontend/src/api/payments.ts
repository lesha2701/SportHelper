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

const RETURN_KEY = "sag_payment_return";

/** Remembered across the trip to the payment page, so coming back lands on the bookings list instead of jumping elsewhere. */
export function rememberPaymentTrip(bookingId: string): void {
  try {
    window.sessionStorage.setItem(RETURN_KEY, bookingId);
  } catch {
    // Without storage the person simply lands where the link says; nothing is lost.
  }
}

export function takePaymentTrip(): string | null {
  try {
    const id = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    return id;
  } catch {
    return null;
  }
}
