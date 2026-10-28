import { describe, expect, it } from "vitest";
import { notificationToOverlay } from "./overlay";

const ID = "11111111-2222-4333-8444-555555555555";

describe("where a money notification leads", () => {
  it("sends the athlete's payment updates to their bookings, on that booking", () => {
    expect(notificationToOverlay("payment_update", ID)).toEqual({ kind: "my-bookings", focusBookingId: ID });
  });

  it("sends the trainer's earnings and withdrawals to «Финансы»", () => {
    expect(notificationToOverlay("earning_update", ID)).toEqual({ kind: "finance" });
    expect(notificationToOverlay("withdrawal_update", ID)).toEqual({ kind: "finance" });
  });

  it("leaves administrators' finance alerts where they are (the admin panel has its own address)", () => {
    expect(notificationToOverlay("finance_admin", ID)).toBeNull();
  });
});
