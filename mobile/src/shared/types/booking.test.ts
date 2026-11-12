import { describe, expect, it } from "@jest/globals";
import { mapBookingDto, type BookingDto } from "./booking";

const dto = (extra: Partial<BookingDto>): BookingDto => ({
  id: "b1", coach_user_id: "c1", coach_full_name: "Тренер", listing_id: null, listing_title: null, athlete_user_id: "a1",
  athlete_full_name: "Игорь", athlete_notes: null, starts_at: "2026-11-16T10:00:00Z", duration_minutes: 60, format: "online",
  price_per_session: null, currency: "RUB", status: "confirmed", is_completed: false, training_id: "t1", training_plan_id: null,
  training_plan_name: null, training_status: "scheduled", has_review: false, has_player_review: false, ...extra,
});

describe("whether a booked session has begun", () => {
  it("is what the server says, not the device's clock (starts_at is Moscow wall-clock time with a UTC label)", () => {
    expect(mapBookingDto(dto({ starts_at: "2999-01-01T10:00:00Z", has_started: true })).hasStarted).toBe(true);
    expect(mapBookingDto(dto({ starts_at: "2000-01-01T10:00:00Z", has_started: false })).hasStarted).toBe(false);
  });

  it("falls back to the device's clock only for an older server that does not say it", () => {
    expect(mapBookingDto(dto({ starts_at: "2000-01-01T10:00:00Z" })).hasStarted).toBe(true);
    expect(mapBookingDto(dto({ starts_at: "2999-01-01T10:00:00Z" })).hasStarted).toBe(false);
  });
});

describe("cancellation of a booking", () => {
  it("shows the cancel button only when the server says so", () => {
    expect(mapBookingDto(dto({ can_cancel: true })).canCancel).toBe(true);
    expect(mapBookingDto(dto({ can_cancel: false })).canCancel).toBe(false);
    expect(mapBookingDto(dto({})).canCancel).toBe(false); // an older server that does not say it
  });

  it("reads who cancelled, why, by which rule and where the money is", () => {
    const booking = mapBookingDto(
      dto({
        status: "cancelled",
        cancellation: {
          cancelled_by_role: "coach", cancelled_at: "2026-11-12T08:00:00Z", reason: "Заболел", policy: "coach",
          refund_percent: 100, refund_amount_kopecks: 150000, refund_status: "pending",
        },
      }),
    );

    expect(booking.status).toBe("cancelled");
    expect(booking.cancellation).toEqual({
      cancelledByRole: "coach", cancelledAt: "2026-11-12T08:00:00Z", reason: "Заболел", policy: "coach",
      refundPercent: 100, refundAmountKopecks: 150000, refundStatus: "pending",
    });
    expect(mapBookingDto(dto({})).cancellation).toBeNull();
  });
});
