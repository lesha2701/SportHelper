import { useCallback, useEffect, useState } from "react";
import { listMyExercises, shareExercise } from "../../api/exercises";
import { listMyTeams } from "../../api/teams";
import { listMyPlans, addPlanExercise } from "../../api/plans";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { ExerciseForm } from "./ExerciseForm";
import { ExerciseDetail } from "./ExerciseDetail";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import type { Exercise } from "../../types/exercise";
import type { Team } from "../../types/team";
import type { Plan } from "../../types/plan";
import profileStyles from "../profile/profile.module.css";
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

function DetailPanel({
  token,
  exercise,
  teams,
  plans,
  onEdit,
  onOpenFull,
  onShared,
}: {
  token: string;
  exercise: Exercise;
  teams: Team[];
  plans: Plan[];
  onEdit: () => void;
  onOpenFull: () => void;
  onShared: () => void;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedInPlans = plans.filter((p) => p.exercises.some((pe) => pe.exerciseId === exercise.id)).length;
  const sharedTeams = teams.filter((t) => exercise.sharedTeamIds.includes(t.id));
  const unsharedTeams = teams.filter((t) => !exercise.sharedTeamIds.includes(t.id));

  const handleAddToPlan = async (planId: string) => {
    setBusy(true);
    setError(null);
    try {
      const plan = plans.find((p) => p.id === planId);
      await addPlanExercise(token, planId, {
        exercise_id: exercise.id,
        section: "main",
        order_index: plan ? plan.exercises.length : 0,
        sets: exercise.sets,
        reps: exercise.reps,
        duration_seconds: exercise.durationSeconds,
        rest_seconds: exercise.restSeconds,
        notes: null,
      });
      setPlanOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить в план");
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async (teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      await shareExercise(token, exercise.id, teamId);
      setTeamOpen(false);
      onShared();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось показать упражнение команде");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={libStyles.detailPanel}>
      <div className={libStyles.detailMedia}>
        {exercise.videoFileId ? (
          <AuthenticatedVideo token={token} fileId={exercise.videoFileId} className={libStyles.detailMediaFill} zoomable />
        ) : exercise.photoFileId ? (
          <AuthenticatedImage token={token} fileId={exercise.photoFileId} alt={exercise.name} className={libStyles.detailMediaFill} zoomable />
        ) : (
          <Icon name="video" size={28} />
        )}
      </div>
      <div className={libStyles.detailBody}>
        <div>
          <span className={libStyles.detailCategory}>{exercise.sport}</span>
          <h2 className={libStyles.detailTitle}>{exercise.name}</h2>
        </div>
        <p className={libStyles.detailDescription}>{exercise.description || "Без описания."}</p>

        <div className={libStyles.detailStatsGrid}>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{exercise.sets && exercise.reps ? `${exercise.sets}×${exercise.reps}` : "—"}</span>
            <span className={libStyles.detailStatLabel}>подходы</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{formatDuration(exercise.durationSeconds) ?? "—"}</span>
            <span className={libStyles.detailStatLabel}>длительность</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{usedInPlans}</span>
            <span className={libStyles.detailStatLabel}>{usedInPlans === 1 ? "план" : "планов"}</span>
          </div>
        </div>

        <div>
          <span className={libStyles.detailSharedLabel}>Показано командам</span>
          <div className={libStyles.detailSharedRow} style={{ marginTop: 8 }}>
            {sharedTeams.map((t) => (
              <span key={t.id} className={libStyles.detailSharedChip}>
                {t.name}
              </span>
            ))}
            {unsharedTeams.length > 0 && (
              <button type="button" className={libStyles.detailAddTeamChip} onClick={() => setTeamOpen((v) => !v)}>
                + команда
              </button>
            )}
          </div>
          {teamOpen && (
            <div className={libStyles.detailDropdown} style={{ marginTop: 6 }}>
              {unsharedTeams.map((t) => (
                <button key={t.id} type="button" className={libStyles.detailDropdownItem} disabled={busy} onClick={() => void handleShare(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className={profileStyles.error}>{error}</p>}

        {planOpen && (
          <div className={libStyles.detailDropdown}>
            {plans.length === 0 ? (
              <span className={libStyles.detailDropdownEmpty}>Пока нет планов тренировок.</span>
            ) : (
              plans.map((p) => (
                <button key={p.id} type="button" className={libStyles.detailDropdownItem} disabled={busy} onClick={() => void handleAddToPlan(p.id)}>
                  {p.name}
                </button>
              ))
            )}
          </div>
        )}

        <div className={libStyles.detailActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setPlanOpen((v) => !v)}>
            В план
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onEdit}>
            Изменить
          </button>
        </div>
        <button type="button" className={libStyles.detailAddTeamChip} style={{ alignSelf: "center" }} onClick={onOpenFull}>
          Подробнее →
        </button>
      </div>
    </div>
  );
}

export function ExercisesScreen({ token }: { token: string }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [teams, setTeams] = useState<Team[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([listMyExercises(token), listMyTeams(token).catch(() => []), listMyPlans(token).catch(() => [])])
      .then(([exercises, teamsList, plansList]) => {
        setState({ status: "ready", exercises });
        setTeams(teamsList);
        setPlans(plansList);
      })
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
    if (q && !exercise.name.toLowerCase().includes(q) && !exercise.sport.toLowerCase().includes(q)) return false;
    return true;
  });

  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;

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
      ) : (
        <>
          <div className={libStyles.toolbarRow}>
            <span className={libStyles.resultCount} style={{ marginLeft: 0 }}>
              {filtered.length} упражнений
            </span>
          </div>

          {filtered.length === 0 ? (
            <StateScreen kind="empty" title="Ничего не найдено" description="Попробуйте изменить запрос или фильтр." />
          ) : (
            <div className={libStyles.libraryLayout}>
              <div className={libStyles.libraryMain}>
                <div className={libStyles.exerciseGrid}>
                  {filtered.map((exercise) => {
                    const duration = formatDuration(exercise.durationSeconds);
                    return (
                      <button
                        key={exercise.id}
                        type="button"
                        className={libStyles.exerciseCard}
                        onClick={() =>
                          isDesktop ? setSelectedId(exercise.id) : setView({ screen: "detail", exerciseId: exercise.id })
                        }
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
                            <span className={libStyles.exerciseCardCategory}>{exercise.sport}</span>
                            <span className={libStyles.exerciseCardShared}>
                              {exercise.sharedTeamIds.length > 0 ? `${exercise.sharedTeamIds.length} команд` : "личное"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {isDesktop && selected && (
                <DetailPanel
                  token={token}
                  exercise={selected}
                  teams={teams}
                  plans={plans}
                  onEdit={() => setView({ screen: "edit", exercise: selected })}
                  onOpenFull={() => setView({ screen: "detail", exerciseId: selected.id })}
                  onShared={load}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
