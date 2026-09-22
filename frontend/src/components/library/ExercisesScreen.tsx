import { useCallback, useEffect, useState } from "react";
import { listMyExercises } from "../../api/exercises";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ExerciseForm } from "./ExerciseForm";
import { ExerciseDetail } from "./ExerciseDetail";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { Exercise } from "../../types/exercise";
import styles from "../teams/teams.module.css";
import libStyles from "./library.module.css";

function formatDuration(seconds: number | null): string | null {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? `${minutes} мин` : `${seconds} сек`;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; exercises: Exercise[] };

type View = { screen: "list" } | { screen: "create" } | { screen: "edit"; exercise: Exercise } | { screen: "detail"; exerciseId: string };

export function ExercisesScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setState({ status: "loading" });
    listMyExercises(token)
      .then((exercises) => setState({ status: "ready", exercises }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить упражнения";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <ExerciseForm
        token={token}
        onSaved={(exercise) => setView({ screen: "detail", exerciseId: exercise.id })}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "edit") {
    return (
      <ExerciseForm
        token={token}
        initial={view.exercise}
        onSaved={(exercise) => setView({ screen: "detail", exerciseId: exercise.id })}
        onCancel={() => setView({ screen: "detail", exerciseId: view.exercise.id })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <ExerciseDetail
        token={token}
        exerciseId={view.exerciseId}
        isOwner
        onBack={() => setView({ screen: "list" })}
        onEdit={(exercise) => setView({ screen: "edit", exercise })}
        onDeleted={() => setView({ screen: "list" })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка упражнений…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить упражнения" description={state.message} onRetry={load} />;
  }

  const filtered = state.exercises.filter((exercise) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return exercise.name.toLowerCase().includes(q) || exercise.sport.toLowerCase().includes(q);
  });

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Упражнения</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          <Icon name="plus" size={16} />
          Создать
        </button>
      </div>

      {state.exercises.length > 0 && (
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Поиск по названию или виду спорта…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {state.exercises.length === 0 ? (
        <StateScreen kind="empty" title="Пока нет упражнений" description="Создайте первое упражнение для своей библиотеки." />
      ) : filtered.length === 0 ? (
        <StateScreen kind="empty" title="Ничего не найдено" description="Попробуйте изменить запрос." />
      ) : (
        <div className={libStyles.exerciseGrid}>
          {filtered.map((exercise) => {
            const duration = formatDuration(exercise.durationSeconds);
            return (
              <button
                key={exercise.id}
                type="button"
                className={libStyles.exerciseCard}
                onClick={() => setView({ screen: "detail", exerciseId: exercise.id })}
              >
                <div className={libStyles.exerciseCardMedia}>
                  {exercise.photoFileId ? (
                    <AuthenticatedImage
                      token={token}
                      fileId={exercise.photoFileId}
                      alt={exercise.name}
                      className={libStyles.exerciseCardMediaImg}
                    />
                  ) : (
                    <div className={libStyles.exerciseCardMediaPlaceholder}>
                      <Icon name={exercise.videoFileId ? "video" : "dumbbell"} size={26} />
                    </div>
                  )}
                  {duration && <span className={libStyles.exerciseDurationBadge}>{duration}</span>}
                </div>
                <div className={libStyles.exerciseCardBody}>
                  <h2 className={libStyles.exerciseCardTitle}>{exercise.name}</h2>
                  <div className={libStyles.exerciseCardFooter}>
                    <span className={libStyles.exerciseCardCategory}>
                      {exercise.difficulty ? SKILL_LEVEL_LABELS[exercise.difficulty] : exercise.sport}
                    </span>
                    <span className={libStyles.exerciseCardShared}>
                      {exercise.sharedTeamIds.length > 0 ? `${exercise.sharedTeamIds.length} команд` : "личное"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
