import { describe, expect, it } from "vitest";
import { overlapMessage } from "./scheduleOverlap";

describe("overlapMessage", () => {
  it("names the day and both windows when two windows of one day overlap", () => {
    expect(
      overlapMessage([
        { weekday: 0, startTime: "10:00", endTime: "12:00" },
        { weekday: 0, startTime: "11:00", endTime: "13:00" },
      ]),
    ).toBe("В понедельник два окна расписания пересекаются (10:00–12:00 и 11:00–13:00). Объедините их в одно или измените время.");
  });

  it("catches two identical windows and uses the right form of the weekday", () => {
    expect(
      overlapMessage([
        { weekday: 1, startTime: "09:00", endTime: "10:00" },
        { weekday: 1, startTime: "09:00", endTime: "10:00" },
      ]),
    ).toMatch(/^Во вторник два окна/);
  });

  it("lets windows that only touch, or are on different days, through", () => {
    expect(
      overlapMessage([
        { weekday: 2, startTime: "10:00", endTime: "11:00" },
        { weekday: 2, startTime: "11:00", endTime: "12:00" },
        { weekday: 3, startTime: "10:00", endTime: "11:00" },
      ]),
    ).toBeNull();
  });

  it("ignores a window whose time is still empty", () => {
    expect(overlapMessage([{ weekday: 0, startTime: "", endTime: "" }, { weekday: 0, startTime: "10:00", endTime: "11:00" }])).toBeNull();
  });
});
