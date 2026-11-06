import type { CalendarEvent } from "@/shared/types/calendar";
import { addDays } from "./dates";

/** A training whose date has passed but that nobody marked as held or cancelled (the website's «Просрочено»). */
export function isOverdue(event: Pick<CalendarEvent, "type" | "status" | "date">, today: string): boolean {
  return event.type === "training" && event.status === "scheduled" && event.date < today;
}

const byDateTime = (a: CalendarEvent, b: CalendarEvent) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date));

/** Today and later first (soonest first), then the past (most recent first) — as the website's list. */
export function upcomingFirst(events: CalendarEvent[], today: string): CalendarEvent[] {
  const future = events.filter((e) => e.date >= today).sort(byDateTime);
  const past = events.filter((e) => e.date < today).sort((a, b) => byDateTime(b, a));
  return [...future, ...past];
}

/** Events sorted by date and time. */
export function chronological(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(byDateTime);
}

/** Consecutive events of the same day put together, keeping the given order. */
export function groupByDay(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  return [...groups.entries()];
}

/** The list looks two weeks back (so a training nobody closed does not vanish) and two months ahead. */
export function listRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -14), to: addDays(today, 60) };
}

export const WEEK_FIRST_HOUR = 8;
export const WEEK_LAST_HOUR = 20;

/** Where a timed event starts in the week grid, in rows from 08:00 (clamped to the grid). */
export function weekRowOffset(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return Math.min(Math.max(h + m / 60 - WEEK_FIRST_HOUR, 0), WEEK_LAST_HOUR - WEEK_FIRST_HOUR - 1);
}
