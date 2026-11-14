export interface ScheduleWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

const ON_WEEKDAY = ["В понедельник", "Во вторник", "В среду", "В четверг", "В пятницу", "В субботу", "В воскресенье"];

/** The same sentence the server gives for two windows of one weekday that overlap, so the mistake is named before anything is sent.
 * Times are «HH:MM» strings from the form (they compare as text); windows with an empty time are left to the other checks. */
export function overlapMessage(windows: ScheduleWindow[]): string | null {
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (!a || !b) continue;
      if (a.weekday !== b.weekday || !a.startTime || !a.endTime || !b.startTime || !b.endTime) continue;
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        return `${ON_WEEKDAY[a.weekday] ?? "В этот день"} два окна расписания пересекаются (${a.startTime}–${a.endTime} и ${b.startTime}–${b.endTime}). Объедините их в одно или измените время.`;
      }
    }
  }
  return null;
}
