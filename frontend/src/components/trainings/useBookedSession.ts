import { useEffect, useState } from "react";
import { listMyBookings } from "../../api/bookings";
import type { Booking } from "../../types/booking";

/** The athlete's booking behind a personal training, or null when the training is their own (or while it is still being looked up).
 * A session booked with a coach belongs to the booking: its date, time, length and place are not the calendar's to change. */
export function useBookedSession(token: string, trainingId: string | null): Booking | null {
  const [booking, setBooking] = useState<Booking | null>(null);
  useEffect(() => {
    if (!trainingId) {
      setBooking(null);
      return;
    }
    let cancelled = false;
    listMyBookings(token)
      .then((all) => !cancelled && setBooking(all.find((b) => b.trainingId === trainingId) ?? null))
      .catch(() => !cancelled && setBooking(null));
    return () => {
      cancelled = true;
    };
  }, [token, trainingId]);
  return booking;
}
