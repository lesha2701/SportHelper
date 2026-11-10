import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WorkoutExercise } from "@/shared/types/training";

const PREFIX = "sag-workout-draft:";

export interface Draft {
  exercises: WorkoutExercise[];
  activeIndex: number;
  startedAt: number;
  restSeconds: number;
}

/** A draft saved by an older version has no metric on its exercises: they were all repetitions. */
function normalize(exercises: WorkoutExercise[]): WorkoutExercise[] {
  return exercises.map((e) => ({
    ...e,
    metric: e.metric ?? "reps",
    sets: e.sets.map((s) => ({
      ...s,
      seconds: s.seconds ?? null,
      meters: s.meters ?? null,
      // A draft written before the fields were limited may hold a value the server would refuse.
      reps: Math.min(10000, s.reps),
      weightKg: s.weightKg === null ? null : Math.min(2000, s.weightKg),
    })),
  }));
}

/** The unfinished workout kept on the device, if it still matches the training's exercise list. */
export async function readDraft(trainingId: string, itemCount: number): Promise<Draft | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + trainingId);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (!Array.isArray(draft.exercises) || draft.exercises.length !== itemCount) return null;
    return { ...draft, exercises: normalize(draft.exercises) };
  } catch {
    return null;
  }
}

export async function writeDraft(trainingId: string, draft: Draft): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + trainingId, JSON.stringify(draft));
  } catch {
    /* storage full or blocked: the workout just cannot be resumed after the app is closed */
  }
}

export async function clearDraft(trainingId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + trainingId);
  } catch {
    /* nothing to clear */
  }
}
