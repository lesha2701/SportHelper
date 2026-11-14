import { useEffect, useState, type FormEvent } from "react";
import { createPersonalTraining, createTeamTraining, deleteTraining, updateTraining } from "../../api/trainings";
import { listMyPlans } from "../../api/plans";
import { listMembers } from "../../api/teams";
import { createPersonalTrainingDraft, type PersonalTrainingStyle } from "../../api/ai";
import { ApiError } from "../../api/client";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Icon } from "../shared/Icon";
import { detectMetric } from "../../lib/workout";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import type { Plan } from "../../types/plan";
import type { TeamMember } from "../../types/team";
import type { Training, TrainingUpdateInput } from "../../types/training";
import profileStyles from "../profile/profile.module.css";
import styles from "./training.module.css";
import aiStyles from "../stats/stats.module.css";
import { navigateApp } from "../../appNav";
import { toast } from "../../toast";
import { rowsWithoutName } from "./exerciseNames";

interface TrainingFormProps {
  token: string;
  mode: "team" | "personal";
  teamId?: string;
  initial?: Training;
  onSaved: (trainings: Training[]) => void;
  onCancel: () => void;
  onDeleted?: () => void;
}

type ExerciseKind = "reps" | "time" | "distance";

const EXERCISE_KINDS: { kind: ExerciseKind; label: string }[] = [
  { kind: "reps", label: "Повторения" },
  { kind: "time", label: "Время" },
  { kind: "distance", label: "Расстояние" },
];

interface ExerciseRow {
  key: string;
  exercise: string;
  /** What one set is measured in. It follows the name until the person picks it by hand. */
  kind: ExerciseKind;
  kindChosen: boolean;
  reps: string;
  sets: string;
  durationSeconds: string;
  distanceMeters: string;
  /** The target time of a distance exercise, in minutes (a run is easier to plan as "15 min" than "900 s"). */
  timeMinutes: string;
}

let rowKeySeq = 0;
function newRow(): ExerciseRow {
  rowKeySeq += 1;
  return {
    key: `row-${rowKeySeq}`,
    exercise: "",
    kind: "reps",
    kindChosen: false,
    reps: "",
    sets: "",
    durationSeconds: "",
    distanceMeters: "",
    timeMinutes: "",
  };
}

/** One exercise line of a "reps" training: the plan with its units, read back by the workout screen. */
function describeExerciseRow(r: ExerciseRow): string {
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

/** A draft exercise (from the AI or typed) as a form row. */
function rowFromDraft(e: { exercise: string; type: ExerciseKind; reps: number | null; sets: number | null; durationSeconds: number | null; distanceMeters: number | null }): ExerciseRow {
  return {
    ...newRow(),
    exercise: e.exercise,
    kind: e.type,
    kindChosen: true,
    reps: e.reps?.toString() ?? "",
    sets: e.sets?.toString() ?? "",
    durationSeconds: e.type === "distance" ? "" : (e.durationSeconds?.toString() ?? ""),
    distanceMeters: e.distanceMeters?.toString() ?? "",
    timeMinutes: e.type === "distance" && e.durationSeconds ? String(Math.round((e.durationSeconds / 60) * 10) / 10) : "",
  };
}

type RecurrencePreset = "1m" | "6m" | "12m" | "custom";
const RECURRENCE_PRESET_MONTHS: Record<Exclude<RecurrencePreset, "custom">, number> = { "1m": 1, "6m": 6, "12m": 12 };

function addMonthsToIsoDate(iso: string, months: number): string {
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const date = new Date(y, m - 1 + months, d);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function buildPersonalTrainingDescription(
  style: PersonalTrainingStyle,
  rows: ExerciseRow[],
  notes: string,
  circuit?: { rounds: string; restSeconds: string },
): string {
  const lines = rows
    .filter((r) => r.exercise.trim())
    .map((r, i) => {
      if (style === "reps") return `${i + 1}. ${describeExerciseRow(r)}`;
      return `${i + 1}. ${r.exercise.trim()}${r.durationSeconds ? ` — ${r.durationSeconds} сек` : ""}`;
    });
  let text = lines.join("\n");
  if (style === "circuit" && circuit && (Number(circuit.rounds) > 0 || Number(circuit.restSeconds) > 0)) {
    text += (text ? "\n\n" : "") + `Кругов: ${Number(circuit.rounds) || 1} · Отдых между подходами и кругами: ${Number(circuit.restSeconds) || 0} сек`;
  }
  if (notes.trim()) {
    text += (text ? "\n\n" : "") + `Пометки: ${notes.trim()}`;
  }
  return text;
}

export function TrainingForm({ token, mode, teamId, initial, onSaved, onCancel, onDeleted }: TrainingFormProps) {
  const isEdit = initial !== undefined;
  const isPersonalCreate = mode === "personal" && !isEdit;

  const [trainingDate, setTrainingDate] = useState(initial?.trainingDate ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime?.slice(0, 5) ?? "");
  const [durationMinutes, setDurationMinutes] = useState(initial?.durationMinutes?.toString() ?? "90");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [planId, setPlanId] = useState(initial?.planId ?? "");
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState(initial?.reminderMinutesBefore?.toString() ?? "60");
  // A reminder is on for a new training and for one that already has it; the box switches it off.
  const [remind, setRemind] = useState(initial ? initial.reminderMinutesBefore !== null : true);
  const reminderValue = remind ? (reminderMinutesBefore ? Number(reminderMinutesBefore) : 60) : null;
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("1m");
  const [customMonths, setCustomMonths] = useState("1");
  const [isIndependent, setIsIndependent] = useState(initial?.type === "independent");
  const [responsibleUserId, setResponsibleUserId] = useState(initial?.responsibleUserId ?? "");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Structured circuit/reps builder — personal-training creation only (see
  // "Доработки после итерации 15" README section for why edit mode keeps
  // the plain textarea instead of trying to re-parse it back into rows).
  const [trainingStyle, setTrainingStyle] = useState<PersonalTrainingStyle>("reps");
  const [exerciseRows, setExerciseRows] = useState<ExerciseRow[]>([newRow()]);
  // Rows the person tried to save without a name: each gets its own message under the field until they type.
  const [missingNames, setMissingNames] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [circuitRounds, setCircuitRounds] = useState("3");
  const [circuitRestSeconds, setCircuitRestSeconds] = useState("60");

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiStyle, setAiStyle] = useState<PersonalTrainingStyle>("reps");
  const [aiGoals, setAiGoals] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const repeatWeeklyUntil =
    repeatWeekly && trainingDate
      ? addMonthsToIsoDate(
          trainingDate,
          recurrencePreset === "custom" ? Math.max(1, Number(customMonths) || 1) : RECURRENCE_PRESET_MONTHS[recurrencePreset],
        )
      : null;

  const handleAiGenerate = async () => {
    setAiError(null);
    setAiLoading(true);
    try {
      const draft = await createPersonalTrainingDraft(token, {
        style: aiStyle,
        goals: aiGoals.trim() || null,
        // The AI draft endpoint requires at least 10 minutes; clamp rather
        // than let a short value the player already typed (e.g. testing a
        // quick 5-minute session) turn into a confusing generic 422.
        duration_minutes: durationMinutes ? Math.max(10, Number(durationMinutes)) : null,
      });
      setTrainingStyle(draft.style);
      setExerciseRows(
        draft.exercises.length
          ? draft.exercises.map((e) => (draft.style === "circuit" ? { ...rowFromDraft({ ...e, type: "time" }), kindChosen: false } : rowFromDraft(e)))
          : [newRow()],
      );
      setNotes(draft.notes ?? "");
      if (draft.durationMinutes !== null) setDurationMinutes(draft.durationMinutes.toString());
      setShowAiPanel(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "player_profile_required") {
        setAiError("Сначала заполните профиль игрока в разделе «Профиль».");
      } else {
        setAiError(err instanceof ApiError ? err.message : "Не удалось сформировать черновик");
      }
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "team") return;
    listMyPlans(token)
      .then(setPlans)
      .catch(() => setPlans([]));
    if (teamId) {
      listMembers(token, teamId)
        .then(setMembers)
        .catch(() => setMembers([]));
    }
  }, [token, mode, teamId]);

  const updateRow = (key: string, patch: Partial<ExerciseRow>) => {
    setExerciseRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setExerciseRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  };

  const handleDelete = async () => {
    if (!initial) return;
    setSaving(true);
    try {
      await deleteTraining(token, initial.id);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить тренировку");
      setSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (isPersonalCreate) {
      const missing = rowsWithoutName(exerciseRows);
      if (missing.length) {
        setMissingNames(missing);
        setError("Укажите название каждого упражнения или уберите лишние строки.");
        return;
      }
    }
    setSaving(true);
    try {
      if (isEdit && initial) {
        const input: TrainingUpdateInput = {
          training_date: trainingDate,
          start_time: `${startTime}:00`,
          duration_minutes: Number(durationMinutes),
          location: location.trim() || null,
          description: description.trim() || null,
          plan_id: planId || null,
          reminder_minutes_before: reminderValue,
          status: initial.status,
          is_independent: mode === "team" ? isIndependent : false,
          responsible_user_id: mode === "team" && isIndependent ? responsibleUserId || null : null,
        };
        const training = await updateTraining(token, initial.id, input);
        onSaved([training]);
        return;
      }

      const createInput = {
        training_date: trainingDate,
        start_time: `${startTime}:00`,
        duration_minutes: Number(durationMinutes),
        location: location.trim() || null,
        description: isPersonalCreate
          ? buildPersonalTrainingDescription(trainingStyle, exerciseRows, notes, { rounds: circuitRounds, restSeconds: circuitRestSeconds }) || null
          : description.trim() || null,
        plan_id: mode === "team" ? planId || null : null,
        reminder_minutes_before: reminderValue,
        repeat_weekly_until: repeatWeeklyUntil,
        is_independent: mode === "team" ? isIndependent : false,
        responsible_user_id: mode === "team" && isIndependent ? responsibleUserId || null : null,
      };
      const trainings =
        mode === "team" && teamId
          ? await createTeamTraining(token, teamId, createInput)
          : await createPersonalTraining(token, createInput);
      toast.success(trainings.length > 1 ? `Создано тренировок: ${trainings.length}` : "Тренировка создана", {
        label: "Посмотреть в календаре",
        onClick: () => navigateApp({ kind: "tab", tab: "calendar" }),
      });
      onSaved(trainings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить тренировку");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>
          {isEdit ? "Редактировать тренировку" : mode === "team" ? "Новая тренировка команды" : "Новая личная тренировка"}
        </h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        {isPersonalCreate && !showAiPanel && (
          <button type="button" className={aiStyles.aiTeaser} style={{ cursor: "pointer", font: "inherit", textAlign: "left" }} onClick={() => setShowAiPanel(true)}>
            <span className={aiStyles.aiTeaserIcon}>
              <Icon name="sparkles" size={20} />
            </span>
            <span className={aiStyles.aiTeaserText}>
              <b>Предложить тренировку с ИИ</b> — учтёт профиль, уровень и цели
            </span>
            <span className={aiStyles.aiTeaserButton}>Предложить</span>
          </button>
        )}

        {isPersonalCreate && showAiPanel && (
          <div className={aiStyles.aiCard}>
            <div className={aiStyles.aiCardHead}>
              <Icon name="sparkles" size={18} />
              <span className={aiStyles.aiCardTitle}>Тренировка с ИИ</span>
            </div>
            <span className={profileStyles.label}>Стиль тренировки</span>
            <div className={aiStyles.aiRadioRow}>
              <label className={aiStyle === "reps" ? aiStyles.aiRadioPillActive : aiStyles.aiRadioPill}>
                <input type="radio" name="aiStyle" checked={aiStyle === "reps"} onChange={() => setAiStyle("reps")} style={{ display: "none" }} />
                На повторения
              </label>
              <label className={aiStyle === "circuit" ? aiStyles.aiRadioPillActive : aiStyles.aiRadioPill}>
                <input type="radio" name="aiStyle" checked={aiStyle === "circuit"} onChange={() => setAiStyle("circuit")} style={{ display: "none" }} />
                Круговая
              </label>
            </div>
            <span className={profileStyles.label}>Пожелание к тренировке (необязательно)</span>
            <textarea
              className={profileStyles.textarea}
              value={aiGoals}
              onChange={(e) => setAiGoals(e.target.value)}
              placeholder="Например: хочу поработать над скоростью"
              maxLength={1000}
            />
            <p className={profileStyles.requiredHint}>
              ИИ учтёт ваш профиль (вид спорта, возраст, уровень, цели) и предложит упражнения ниже — их можно
              отредактировать перед сохранением.
            </p>
            {aiError && <p className={profileStyles.error}>{aiError}</p>}
            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleAiGenerate()} disabled={aiLoading}>
                {aiLoading ? "Формирую…" : "Предложить тренировку"}
              </button>
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowAiPanel(false)} disabled={aiLoading}>
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className={profileStyles.fieldGrid}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Дата<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input className={profileStyles.input} type="date" value={trainingDate} onChange={(e) => setTrainingDate(e.target.value)} required />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Время<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input className={profileStyles.input} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </label>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Длительность, мин<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input
            className={profileStyles.input}
            type="number"
            min={1}
            max={600}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            required
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Место</span>
          <input className={profileStyles.input} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </label>

        {mode === "team" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 12,
              border: "1px solid var(--color-primary)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-surface-alt)",
            }}
          >
            <label className={profileStyles.field} style={{ margin: 0 }}>
              <span className={profileStyles.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="book" size={16} />
                Взять план из библиотеки
              </span>
              <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Без плана</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <p className={profileStyles.subtitle} style={{ margin: 0 }}>
              {plans.length === 0
                ? "В вашей библиотеке пока нет планов. Создайте план во вкладке «Библиотека» — и он появится здесь."
                : "Игроки увидят план в карточке тренировки."}
            </p>
          </div>
        )}

        {mode === "team" && (
          <CollapsibleSection label="Настройки команды" defaultOpen={isEdit}>
            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={isIndependent} onChange={(e) => setIsIndependent(e.target.checked)} />
              <span className={profileStyles.label}>Самостоятельная тренировка (без тренера)</span>
            </label>

            {isIndependent && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Ответственный игрок</span>
                <select className={profileStyles.select} value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
                  <option value="">По умолчанию — капитан</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.firstName} {m.lastName ?? ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </CollapsibleSection>
        )}

        {isPersonalCreate ? (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Упражнения</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="trainingStyle" checked={trainingStyle === "reps"} onChange={() => setTrainingStyle("reps")} />
                <span>На повторения</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="trainingStyle" checked={trainingStyle === "circuit"} onChange={() => setTrainingStyle("circuit")} />
                <span>Круговая</span>
              </label>
            </div>

            {exerciseRows.map((row, index) => (
              <div key={row.key} className={styles.exerciseRow}>
                <div className={styles.exerciseRowTop}>
                  <input
                    className={`${profileStyles.input} ${styles.exerciseNameInput}`}
                    placeholder={`Упражнение ${index + 1}`}
                    value={row.exercise}
                    onChange={(e) => {
                      if (missingNames.includes(row.key)) setMissingNames((keys) => keys.filter((k) => k !== row.key));
                      updateRow(row.key, {
                        exercise: e.target.value,
                        // The kind follows the name ("Бег" -> distance) until it is picked by hand.
                        ...(row.kindChosen ? {} : { kind: detectMetric(e.target.value).metric }),
                      });
                    }}
                    maxLength={150}
                    aria-invalid={missingNames.includes(row.key) || undefined}
                  />
                  <button
                    type="button"
                    className={styles.exerciseRemoveButton}
                    onClick={() => removeRow(row.key)}
                    disabled={exerciseRows.length === 1}
                    aria-label="Удалить упражнение"
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
                {missingNames.includes(row.key) && (
                  <span role="alert" className={profileStyles.error}>
                    Укажите название упражнения.
                  </span>
                )}

                {trainingStyle === "reps" ? (
                  <>
                    <div className={styles.kindPicker} role="group" aria-label="Чем измеряется упражнение">
                      {EXERCISE_KINDS.map((option) => (
                        <button
                          key={option.kind}
                          type="button"
                          className={row.kind === option.kind ? `${styles.kindOption} ${styles.kindOptionOn}` : styles.kindOption}
                          aria-pressed={row.kind === option.kind}
                          onClick={() => updateRow(row.key, { kind: option.kind, kindChosen: true })}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className={styles.exerciseFieldsRow}>
                      {row.kind === "reps" && (
                        <label className={styles.exerciseField}>
                          <span className={styles.exerciseFieldLabel}>Повторения за подход</span>
                          <input
                            className={profileStyles.input}
                            type="number"
                            min={0}
                            placeholder="10"
                            value={row.reps}
                            onChange={(e) => updateRow(row.key, { reps: e.target.value })}
                          />
                        </label>
                      )}
                      {row.kind === "time" && (
                        <label className={styles.exerciseField}>
                          <span className={styles.exerciseFieldLabel}>Время за подход, сек</span>
                          <input
                            className={profileStyles.input}
                            type="number"
                            min={0}
                            placeholder="30"
                            value={row.durationSeconds}
                            onChange={(e) => updateRow(row.key, { durationSeconds: e.target.value })}
                          />
                        </label>
                      )}
                      {row.kind === "distance" && (
                        <>
                          <label className={styles.exerciseField}>
                            <span className={styles.exerciseFieldLabel}>Расстояние, м</span>
                            <input
                              className={profileStyles.input}
                              type="number"
                              min={0}
                              placeholder="1000"
                              value={row.distanceMeters}
                              onChange={(e) => updateRow(row.key, { distanceMeters: e.target.value })}
                            />
                          </label>
                          <label className={styles.exerciseField}>
                            <span className={styles.exerciseFieldLabel}>Время, мин (по желанию)</span>
                            <input
                              className={profileStyles.input}
                              type="number"
                              min={0}
                              step={0.5}
                              placeholder="10"
                              value={row.timeMinutes}
                              onChange={(e) => updateRow(row.key, { timeMinutes: e.target.value })}
                            />
                          </label>
                        </>
                      )}
                      <label className={styles.exerciseField}>
                        <span className={styles.exerciseFieldLabel}>Количество подходов</span>
                        <input
                          className={profileStyles.input}
                          type="number"
                          min={0}
                          placeholder={row.kind === "distance" ? "1" : "3"}
                          value={row.sets}
                          onChange={(e) => updateRow(row.key, { sets: e.target.value })}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <div className={styles.exerciseFieldsRowSingle}>
                    <label className={styles.exerciseField}>
                      <span className={styles.exerciseFieldLabel}>Длительность упражнения, секунд</span>
                      <input
                        className={profileStyles.input}
                        type="number"
                        min={0}
                        value={row.durationSeconds}
                        onChange={(e) => updateRow(row.key, { durationSeconds: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setExerciseRows((rows) => [...rows, newRow()])}>
              + Добавить упражнение
            </button>

            {trainingStyle === "circuit" && (
              <div className={profileStyles.fieldGrid} style={{ marginTop: 8 }}>
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>Кругов</span>
                  <input
                    className={profileStyles.input}
                    type="number"
                    min={1}
                    max={20}
                    value={circuitRounds}
                    onChange={(e) => setCircuitRounds(e.target.value)}
                  />
                </label>
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>Отдых между подходами и кругами, сек</span>
                  <input
                    className={profileStyles.input}
                    type="number"
                    min={0}
                    max={600}
                    value={circuitRestSeconds}
                    onChange={(e) => setCircuitRestSeconds(e.target.value)}
                  />
                </label>
              </div>
            )}

            <label className={profileStyles.field} style={{ marginTop: 8 }}>
              <span className={profileStyles.label}>Пометки (необязательно)</span>
              <textarea className={profileStyles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </label>
          </div>
        ) : (
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Описание</span>
            <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </label>
        )}

        <CollapsibleSection label="Напоминание" defaultOpen={isEdit}>
          <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span className={profileStyles.label}>Напоминать об этой тренировке</span>
          </label>
          {remind && (
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Напомнить за, мин</span>
              <input
                className={profileStyles.input}
                type="number"
                min={0}
                max={10080}
                value={reminderMinutesBefore}
                onChange={(e) => setReminderMinutesBefore(e.target.value)}
              />
            </label>
          )}
        </CollapsibleSection>

        {!isEdit && (
          <CollapsibleSection label="Повторение">
            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
              <span className={profileStyles.label}>Применять для каждой недели</span>
            </label>

            {repeatWeekly && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Повторять</span>
                {(
                  [
                    { key: "1m", label: "1 месяц" },
                    { key: "6m", label: "Полгода" },
                    { key: "12m", label: "Год" },
                    { key: "custom", label: "Указать количество месяцев" },
                  ] as const
                ).map((opt) => (
                  <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <input type="radio" name="recurrencePreset" checked={recurrencePreset === opt.key} onChange={() => setRecurrencePreset(opt.key)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
                {recurrencePreset === "custom" && (
                  <input
                    className={profileStyles.input}
                    type="number"
                    min={1}
                    max={24}
                    value={customMonths}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                )}
              </div>
            )}
          </CollapsibleSection>
        )}

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>

      {isEdit && onDeleted && (
        <div className={profileStyles.card}>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)} disabled={saving}>
            Удалить тренировку
          </button>
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить тренировку?"
          danger
          busy={saving}
          confirmLabel="Удалить"
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </form>
  );
}
