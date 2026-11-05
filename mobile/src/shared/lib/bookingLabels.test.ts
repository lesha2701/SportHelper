import { describe, expect, it } from "@jest/globals";
import { canPay } from "./bookingLabels";

describe("canPay", () => {
  it("allows paying a confirmed session that is not paid yet, or whose payment failed", () => {
    expect(canPay("confirmed", "unpaid")).toBe(true);
    expect(canPay("confirmed", "canceled")).toBe(true);
    expect(canPay("confirmed", "processing")).toBe(true);
  });

  it("does not offer payment for a paid, free, refunded or unconfirmed session", () => {
    expect(canPay("confirmed", "paid")).toBe(false);
    expect(canPay("confirmed", "not_required")).toBe(false);
    expect(canPay("confirmed", "refunded")).toBe(false);
    expect(canPay("pending", "unpaid")).toBe(false);
    expect(canPay("declined", "unpaid")).toBe(false);
  });
});
