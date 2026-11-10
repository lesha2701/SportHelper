/** Dates travel as "YYYY-MM-DD" and times as "HH:MM"; people type "ДД.ММ.ГГГГ" and "ЧЧ:ММ". All local time. */

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

export function todayIso(now: Date = new Date()): string {
  return toIso(now);
}

/** Monday of the week the date falls in. */
export function startOfWeekIso(iso: string): string {
  const d = parseIso(iso);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return toIso(d);
}

/** "05.11.2026" -> "2026-11-05"; null when it is not a real calendar date. */
export function parseRuDate(text: string): string | null {
  const match = /^\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\s*$/.exec(text);
  if (!match) return null;
  const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function formatRuDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** "9:5" is not a time; "09:05" and "9:05" are. Returns "HH:MM" or null. */
export function parseTime(text: string): string | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null;
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** "пн, 5 ноября". */
export function formatDayTitle(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "14:30" from "14:30:00". */
export function shortTime(time: string | null): string {
  return time ? time.slice(0, 5) : "";
}
