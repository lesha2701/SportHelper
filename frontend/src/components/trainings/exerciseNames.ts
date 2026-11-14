/** The fields of an exercise row the rule needs; the form's own row type has more. */
export interface NamedRow {
  key: string;
  exercise: string;
  reps: string;
  sets: string;
  durationSeconds: string;
  distanceMeters: string;
  timeMinutes: string;
}

/** The rows of a personal training that have no name. Every exercise on the list needs one; the form starts with one empty row, which
 * is fine while it is untouched (a training without exercises), but a row with numbers and no name, or any empty row beside others, is not. */
export function rowsWithoutName(rows: NamedRow[]): string[] {
  return rows
    .filter((r) => {
      if (r.exercise.trim()) return false;
      if (rows.length > 1) return true;
      return Boolean(r.reps.trim() || r.sets.trim() || r.durationSeconds.trim() || r.distanceMeters.trim() || r.timeMinutes.trim());
    })
    .map((r) => r.key);
}
