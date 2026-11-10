import { Linking } from "react-native";
import { apiRequest } from "./client";
import { mapBookingDto, type Booking, type BookingDto } from "@/shared/types/booking";

/** The athlete pressed «Оплатить эту тренировку»: the server returns the ЮKassa page to send them to. */
export async function startBookingPayment(bookingId: string): Promise<{ confirmationUrl: string }> {
  const dto = await apiRequest<{ confirmation_url: string }>(`/api/bookings/${bookingId}/pay`, { method: "POST", silent: true });
  return { confirmationUrl: dto.confirmation_url };
}

/** Asks the server to check with the payment service how the booking's payment ended. */
export async function syncBookingPayment(bookingId: string): Promise<Booking> {
  return mapBookingDto(await apiRequest<BookingDto>(`/api/bookings/${bookingId}/payment/sync`, { method: "POST", silent: true }));
}

/** Opens the payment page in the system browser; the person comes back to the app by hand (or by the return link). */
export async function openPaymentPage(url: string): Promise<void> {
  await Linking.openURL(url);
}
