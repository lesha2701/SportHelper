import { useCallback, useEffect, useState } from "react";
import { addPlanExercise, deletePlan, duplicatePlan, getPlan, removePlanExercise, sharePlan, unsharePlan } from "../../api/plans";
import { listMyExercises } from "../../api/exercises";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { PLAN_SECTIONS, PLAN_SECTION_LABELS, type Plan, type PlanSection } from "../../types/plan";
import type { Exercise } from "../../types/exercise";
import type { Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libraryStyles from "./library.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; plan: Plan };

export function PlanDetail({
  token,
  planId,
  isOwner = true,
  onBack,
  onEdit,
  onDeleted,
  onDuplicated,
}: {
  token: string;
  planId: string;
  isOwner?: boolean;
  onBack: () => void;
  onEdit?: (plan: Plan) => void;
  onDeleted?: () => void;
  onDuplicated?: (plan: Plan) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [myExercises, setMyExercises] = useState<Exercise[]>([]);
  const [myCoachTeams, setMyCoachTeams] = useState<Team[]>([]);
  const [addingToSection, setAddingToSection] = useState<PlanSection | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getPlan(token, planId)
      .then((plan) => setState({ status: "ready", plan }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить план";
        setState({ status: "error", message });
      });
  }, [token, planId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!isOwner) return;
    listMyExercises(token)
      .then(setMyExercises)
      .catch(() => setMyExercises([]));
    listMyTeams(token)
      .then((teams) => setMyCoachTeams(teams.filter((t) => t.myRole === "head_coach" || t.myRole === "assistant_coach")))
      .catch(() => setMyCoachTeams([]));
  }, [token, isOwner]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка плана…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить план" description={state.message} onRetry={load} />;
  }

  const { plan } = state;

  const handleRemove = async (planExerciseId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await removePlanExercise(token, plan.id, planExerciseId);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось убрать упражнение");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deletePlan(token, plan.id);
      onDeleted?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить план");
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const copy = await duplicatePlan(token, plan.id);
      onDuplicated?.(copy);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось дублировать план");
      setBusy(false);
    }
  };

  const toggleShare = async (teamId: string, shared: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      if (shared) {
        await unsharePlan(token, plan.id, teamId);
      } else {
        await sharePlan(token, plan.id, teamId);
      }
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось изменить видимость");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          ← Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.title}>{plan.name}</h1>
        <p className={profileStyles.subtitle}>{plan.sport}</p>
        {plan.description && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Описание</span>
            <span className={profileStyles.rowValue}>{plan.description}</span>
          </div>
        )}
        {plan.durationMinutes !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Длительность</span>
            <span className={profileStyles.rowValue}>{plan.durationMinutes} мин</span>
          </div>
        )}
        {plan.equipment && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Инвентарь</span>
            <span className={profileStyles.rowValue}>{plan.equipment}</span>
          </div>
        )}
        {plan.comment && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Комментарий</span>
            <span className={profileStyles.rowValue}>{plan.comment}</span>
          </div>
        )}
      </div>

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {PLAN_SECTIONS.map((section) => {
        const items = plan.exercises.filter((e) => e.section === section);
        return (
          <div key={section} className={profileStyles.card}>
            <h2 className={libraryStyles.sectionTitle}>{PLAN_SECTION_LABELS[section]}</h2>

            {items.length === 0 && <p className={profileStyles.subtitle}>Пусто</p>}

            {items.map((item) => (
              <div key={item.id} className={libraryStyles.planExerciseRow}>
                <div>
                  <div className={libraryStyles.planExerciseName}>{item.exerciseName ?? "Упражнение удалено"}</div>
                  <div className={libraryStyles.planExerciseMeta}>
                    {[
                      item.sets !== null ? `${item.sets} подх.` : null,
                      item.reps !== null ? `${item.reps} повт.` : null,
                      item.durationSeconds !== null ? `${item.durationSeconds} сек` : null,
                      item.restSeconds !== null ? `отдых ${item.restSeconds} сек` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {isOwner && (
                  <button type="button" className={libraryStyles.removeButton} onClick={() => void handleRemove(item.id)} disabled={busy}>
                    Убрать
                  </button>
                )}
              </div>
            ))}

            {isOwner &&
              (addingToSection === section ? (
                <AddExerciseToSection
                  token={token}
                  planId={plan.id}
                  section={section}
                  orderIndex={items.length}
                  exercises={myExercises}
                  onAdded={() => {
                    setAddingToSection(null);
                    load();
                  }}
                  onCancel={() => setAddingToSection(null)}
                />
              ) : (
                <button type="button" className={profileStyles.buttonSecondary} onClick={() => setAddingToSection(section)}>
                  + Добавить упражнение
                </button>
              ))}
          </div>
        );
      })}

      {isOwner && myCoachTeams.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Показать командам</h2>
          <p className={profileStyles.subtitle}>Участники увидят план как необязательный материал.</p>
          {myCoachTeams.map((team) => {
            const shared = plan.sharedTeamIds.includes(team.id);
            return (
              <button
                key={team.id}
                type="button"
                className={shared ? styles.badge : styles.iconButton}
                style={{ marginRight: 8, marginBottom: 8 }}
                onClick={() => void toggleShare(team.id, shared)}
                disabled={busy}
              >
                {shared ? "✓ " : ""}
                {team.name}
              </button>
            );
          })}
        </div>
      )}

      {isOwner && (
        <div className={profileStyles.card}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => onEdit?.(plan)}>
            Редактировать план
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleDuplicate()} disabled={busy}>
            Дублировать
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)}>
            Удалить план
          </button>
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить план?"
          danger
          busy={busy}
          confirmLabel="Удалить"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function AddExerciseToSection({
  token,
  planId,
  section,
  orderIndex,
  exercises,
  onAdded,
  onCancel,
}: {
  token: string;
  planId: string;
  section: PlanSection;
  orderIndex: number;
  exercises: Exercise[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? "");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [restSeconds, setRestSeconds] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (exercises.length === 0) {
    return (
      <p className={profileStyles.subtitle}>
        В библиотеке нет упражнений. Сначала создайте их во вкладке «Упражнения».
      </p>
    );
  }

  const handleAdd = async () => {
    setSaving(true);
    setError(null);
    try {
      await addPlanExercise(token, planId, {
        exercise_id: exerciseId,
        section,
        order_index: orderIndex,
        sets: sets ? Number(sets) : null,
        reps: reps ? Number(reps) : null,
        duration_seconds: durationSeconds ? Number(durationSeconds) : null,
        rest_seconds: restSeconds ? Number(restSeconds) : null,
        notes: notes.trim() || null,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить упражнение");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={libraryStyles.pickerRow}>
      <label className={profileStyles.field}>
        <span className={profileStyles.label}>Упражнение</span>
        <select className={profileStyles.select} value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
          {exercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name}
            </option>
          ))}
        </select>
      </label>
      <div className={profileStyles.fieldGrid}>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Подходы</span>
          <input className={profileStyles.input} type="number" min={0} value={sets} onChange={(e) => setSets(e.target.value)} />
        </label>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Повторения</span>
          <input className={profileStyles.input} type="number" min={0} value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
      </div>
      <div className={profileStyles.fieldGrid}>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Длительность, сек</span>
          <input className={profileStyles.input} type="number" min={0} value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} />
        </label>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Отдых, сек</span>
          <input className={profileStyles.input} type="number" min={0} value={restSeconds} onChange={(e) => setRestSeconds(e.target.value)} />
        </label>
      </div>
      <label className={profileStyles.field}>
        <span className={profileStyles.label}>Заметка</span>
        <input className={profileStyles.input} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </label>

      {error && <p className={profileStyles.error}>{error}</p>}

      <div className={profileStyles.formActions}>
        <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleAdd()} disabled={saving}>
          {saving ? "Добавление…" : "Добавить"}
        </button>
        <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
          Отмена
        </button>
      </div>
    </div>
  );
}
