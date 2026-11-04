import { describe, expect, it } from "@jest/globals";
import { addDays, formatDayTitle, formatRuDate, parseRuDate, parseTime, shortTime, startOfWeekIso, todayIso } from "./dates";

describe("dates", () => {
  it("parses what people type and rejects impossible dates", () => {
    expect(parseRuDate("05.11.2026")).toBe("2026-11-05");
    expect(parseRuDate(" 5/1/2027 ")).toBe("2027-01-05");
    expect(parseRuDate("31.02.2026")).toBeNull();
    expect(parseRuDate("2026-11-05")).toBeNull();
    expect(formatRuDate("2026-11-05")).toBe("05.11.2026");
  });

  it("parses times", () => {
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("10:5")).toBeNull();
    expect(shortTime("14:30:00")).toBe("14:30");
  });

  it("moves across month ends and finds the Monday of a week", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(startOfWeekIso("2026-11-08")).toBe("2026-11-02"); // a Sunday belongs to the week before
    expect(startOfWeekIso("2026-11-04")).toBe("2026-11-02");
    expect(todayIso(new Date(2026, 10, 4))).toBe("2026-11-04");
  });

  it("titles a day in Russian", () => {
    expect(formatDayTitle("2026-11-05")).toBe("чт, 5 ноября");
  });
});
