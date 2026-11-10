/** A personal training's exercise list is stored as plain text; these functions write and read that exact format
 * (the same one the website's training form produces), so a training made on either side opens on the other. */

import { parseExerciseTarget } from "./workout";

export type ExerciseKind = "reps" | "time" | "distance";

export interface ExerciseRow {
  exercise: string;
  kind: ExerciseKind;
  sets: string;
  reps: string;
  durationSeconds: string;
  distanceMeters: string;
  timeMinutes: string;
}

export function newRow(): ExerciseRow {
  return { exercise: "", kind: "reps", sets: "3", reps: "10", durationSeconds: "30", distanceMeters: "1000", timeMinutes: "" };
}

/** The form rows of a stored exercise list, for editing it again. */
export function rowsFromChecklist(items: { text: string }[]): ExerciseRow[] {
  return items.map((item) => {
    const target = parseExerciseTarget(item.text);
    const kind: ExerciseKind = target.metric ?? "reps";
    return {
      ...newRow(),
      exercise: target.name,
      kind,
      sets: target.sets ? String(target.sets) : kind === "distance" ? "1" : "3",
      reps: target.reps ? String(target.reps) : "10",
      durationSeconds: target.seconds && kind === "time" ? String(target.seconds) : "30",
      distanceMeters: target.meters ? String(target.meters) : "1000",
      timeMinutes: target.seconds && kind === "distance" ? String(Math.round((target.seconds / 60) * 10) / 10) : "",
    };
  });
}

export function describeExerciseRow(r: ExerciseRow): string {
  const name = r.exercise.trim();
  const sets = Number(r.sets) > 0 ? Number(r.sets) : null;
  if (r.kind === "time") {
    return `${name} — ${[`${sets ?? 1} подх.`, `${Number(r.durationSeconds) > 0 ? Number(r.durationSeconds) : 30} сек`].join(" x ")}`;
  }
  if (r.kind === "distance") {
    const minutes = Number(r.timeMinutes.replace(",", "."));
    const parts = [
      sets && sets > 1 ? `${sets} подх.` : null,
      `${Number(r.distanceMeters) > 0 ? Number(r.distanceMeters) : 1000} м`,
      minutes > 0 ? `${Math.round(minutes * 60)} сек` : null,
    ].filter(Boolean);
    return `${name} — ${parts.join(" x ")}`;
  }
  const parts = [sets ? `${sets} подх.` : null, Number(r.reps) > 0 ? `${r.reps} повт.` : null].filter(Boolean);
  return `${name}${parts.length ? ` — ${parts.join(" x ")}` : ""}`;
}

/** "1. Приседания — 3 подх. x 10 повт." per line, then an optional "Пометки: …" block. */
export function buildPersonalDescription(rows: ExerciseRow[], notes: string): string {
  const lines = rows.filter((r) => r.exercise.trim()).map((r, i) => `${i + 1}. ${describeExerciseRow(r)}`);
  let text = lines.join("\n");
  if (notes.trim()) text += (text ? "\n\n" : "") + `Пометки: ${notes.trim()}`;
  return text;
}

export interface ParsedExerciseChecklist {
  items: { text: string; durationSeconds: number | null }[];
  rounds: number | null;
  restSeconds: number | null;
  notes: string | null;
}

/** Reads the text above back into exercises; null when the description is not in that shape (free text stays text). */
export function parseExerciseChecklist(description: string): ParsedExerciseChecklist | null {
  const blocks = description
    .split("\n\n")
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return null;

  let notes: string | null = null;
  let rounds: number | null = null;
  let restSeconds: number | null = null;
  const remaining: string[] = [];

  for (const block of blocks) {
    const notesMatch = block.match(/^Пометки: ([\s\S]*)$/);
    if (notesMatch) {
      notes = (notesMatch[1] ?? "").trim();
      continue;
    }
    const circuitMatch = block.match(/^Кругов: (\d+) · Отдых.*?: (\d+) сек$/);
    if (circuitMatch) {
      rounds = Number(circuitMatch[1]);
      restSeconds = Number(circuitMatch[2]);
      continue;
    }
    remaining.push(block);
  }

  const body = remaining.length === 1 ? remaining[0] : undefined;
  if (!body) return null;
  const lines = body.split("\n").filter((line) => line.trim());
  if (lines.length === 0 || !lines.every((line) => /^\d+\.\s+\S/.test(line))) return null;

  const items = lines.map((line) => {
    const withoutIndex = line.replace(/^\d+\.\s+/, "");
    const durationMatch = withoutIndex.match(/^(.*) — (\d+) сек$/);
    return durationMatch
      ? { text: durationMatch[1] ?? withoutIndex, durationSeconds: Number(durationMatch[2]) }
      : { text: withoutIndex, durationSeconds: null };
  });
  return { items, rounds, restSeconds, notes };
}
