import { describe, expect, it } from "@jest/globals";
import { canPay, dayChip, groupSlotsByDay, timeOf } from "./bookingLabels";

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

describe("free times by day", () => {
  it("groups the times of each day, days and times in order", () => {
    const slots = [
      { startsAt: "2026-11-07T11:00:00Z" },
      { startsAt: "2026-11-06T13:00:00Z" },
      { startsAt: "2026-11-06T10:00:00Z" },
    ];
    expect(groupSlotsByDay(slots)).toEqual([
      { day: "2026-11-06", slots: [{ startsAt: "2026-11-06T10:00:00Z" }, { startsAt: "2026-11-06T13:00:00Z" }] },
      { day: "2026-11-07", slots: [{ startsAt: "2026-11-07T11:00:00Z" }] },
    ]);
  });

  it("labels a day chip and a time", () => {
    expect(dayChip("2026-11-06")).toEqual({ weekday: "пт", date: "6 ноя" });
    expect(timeOf("2026-11-06T10:00:00Z")).toBe("10:00");
  });
});
