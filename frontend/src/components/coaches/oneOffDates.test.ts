import { describe, expect, it } from "vitest";
import { datesProblem, formatSlotDate, todayIso } from "./oneOffDates";

const d = (slotDate: string, startTime = "18:00", endTime = "20:00") => ({ slotDate, startTime, endTime });

describe("datesProblem", () => {
  it("accepts today and later days, and neighbouring windows on one day", () => {
    expect(datesProblem([d("2026-12-01"), d("2026-12-01", "20:00", "21:00"), d("2026-12-02")], "2026-12-01")).toBeNull();
  });

  it("names an empty field, a backwards time, a past day and two crossing windows", () => {
    expect(datesProblem([d("")], "2026-12-01")).toContain("Заполните");
    expect(datesProblem([d("2026-12-02", "20:00", "18:00")], "2026-12-01")).toContain("позже");
    expect(datesProblem([d("2026-11-30")], "2026-12-01")).toContain("уже прошла");
    expect(datesProblem([d("2026-12-02"), d("2026-12-02", "19:00", "21:00")], "2026-12-01")).toContain("пересекаются");
  });
});

describe("date helpers", () => {
  it("writes a day the way people read it, and today as an ISO date of the local calendar", () => {
    expect(formatSlotDate("2026-12-12")).toMatch(/12 декабря/);
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
