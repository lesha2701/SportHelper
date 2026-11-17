/** One-off dates of a listing's schedule, as the form keeps them: «YYYY-MM-DD» and «HH:MM» strings. */
export interface DateDraft {
  /** Set once the date exists on the server (then it is removed through the API, not just from the form). */
  id?: string;
  slotDate: string;
  startTime: string;
  endTime: string;
}

/** «пт, 12 декабря» for «2026-12-12» (a date without a time zone, so it is read as a local day). */
export function formatSlotDate(slotDate: string): string {
  const [y, m, d] = slotDate.split("-").map(Number);
  if (!y || !m || !d) return slotDate;
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
}

export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What is wrong with the one-off dates of the form, in words for the coach, or null. (The server checks the same again.) */
export function datesProblem(dates: DateDraft[], today: string = todayIso()): string | null {
  for (const d of dates) {
    if (!d.slotDate || !d.startTime || !d.endTime) return "Заполните дату и время во всех разовых датах.";
    if (d.startTime >= d.endTime) return "В разовых датах время окончания должно быть позже времени начала.";
    if (d.slotDate < today) return `Дата ${formatSlotDate(d.slotDate)} уже прошла. Выберите дату в будущем.`;
  }
  for (let i = 0; i < dates.length; i += 1) {
    for (let j = i + 1; j < dates.length; j += 1) {
      const a = dates[i];
      const b = dates[j];
      if (a && b && a.slotDate === b.slotDate && a.startTime < b.endTime && b.startTime < a.endTime) {
        return `На ${formatSlotDate(a.slotDate)} два окна пересекаются (${a.startTime}–${a.endTime} и ${b.startTime}–${b.endTime}). Объедините их или измените время.`;
      }
    }
  }
  return null;
}

/** The dates in the order they are shown: by day, then by start time. */
export function sortDates(dates: DateDraft[]): DateDraft[] {
  return [...dates].sort((a, b) => a.slotDate.localeCompare(b.slotDate) || a.startTime.localeCompare(b.startTime));
}
