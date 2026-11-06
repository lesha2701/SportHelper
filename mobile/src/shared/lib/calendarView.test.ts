import { describe, expect, it } from "@jest/globals";
import type { CalendarEvent } from "@/shared/types/calendar";
import { groupByDay, isOverdue, listRange, upcomingFirst, weekRowOffset } from "./calendarView";

const ev = (id: string, date: string, time: string | null = null, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  type: "training",
  date,
  time,
  title: id,
  teamId: null,
  teamName: null,
  status: "scheduled",
  ...extra,
});

describe("calendar view", () => {
  it("marks only past scheduled trainings as overdue", () => {
    expect(isOverdue(ev("a", "2026-11-01"), "2026-11-06")).toBe(true);
    expect(isOverdue(ev("b", "2026-11-06"), "2026-11-06")).toBe(false);
    expect(isOverdue(ev("c", "2026-11-01", null, { status: "completed" }), "2026-11-06")).toBe(false);
    expect(isOverdue(ev("d", "2026-11-01", null, { type: "match" }), "2026-11-06")).toBe(false);
  });

  it("puts the coming days first, then the past from the latest", () => {
    const list = [ev("past1", "2026-11-01"), ev("late", "2026-11-08", "18:00"), ev("past2", "2026-11-04"), ev("early", "2026-11-08", "09:00"), ev("today", "2026-11-06")];
    expect(upcomingFirst(list, "2026-11-06").map((e) => e.id)).toEqual(["today", "early", "late", "past2", "past1"]);
  });

  it("groups by day keeping the order", () => {
    const groups = groupByDay([ev("a", "2026-11-08"), ev("b", "2026-11-08"), ev("c", "2026-11-04")]);
    expect(groups.map(([d, l]) => [d, l.length])).toEqual([
      ["2026-11-08", 2],
      ["2026-11-04", 1],
    ]);
  });

  it("looks two weeks back and two months ahead", () => {
    expect(listRange("2026-11-06")).toEqual({
      from: "2026-10-23",
      to: "2027-01-05",
    });
  });

  it("places events in the 08–20 grid", () => {
    expect(weekRowOffset("08:00:00")).toBe(0);
    expect(weekRowOffset("10:30")).toBe(2.5);
    expect(weekRowOffset("06:00")).toBe(0);
    expect(weekRowOffset("22:00")).toBe(11);
  });
});
