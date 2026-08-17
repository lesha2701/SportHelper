import { useEffect, useState, type FormEvent } from "react";
import { createTask, updateTask } from "../../api/tasks";
import { listMyExercises } from "../../api/exercises";
import { listMyPlans } from "../../api/plans";
import { listMembers } from "../../api/teams";
import { listTeamTrainings } from "../../api/trainings";
import { createTaskDraft } from "../../api/ai";
import { ApiError } from "../../api/client";
import type { Exercise } from "../../types/exercise";
import type { Plan } from "../../types/plan";
import type { TeamMember } from "../../types/team";
import type { Training } from "../../types/training";
import type { Task, TaskTargetType } from "../../types/task";
import type { TaskTemplate } from "../../types/taskTemplate";
import { Icon } from "../shared/Icon";
import { DragReorderList } from "../shared/DragReorderList";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import profileStyles from "../profile/profile.module.css";
import libraryStyles from "../library/library.module.css";

interface TaskFormProps {
  token: string;
  teamId: string;
  initial?: Task;
  /** Seeds a brand-new task's content fields from a saved template — still
   * goes through the normal create flow (target/deadline picked here). */
  prefill?: TaskTemplate;
  onSaved: (task: Task) => void;
  onCancel: () => void;
}

const REQUIREMENT_FIELDS: { key: keyof typeof INITIAL_REQUIREMENTS; label: string }[] = [
  { key: "requireComment", label: "Комментарий" },
  { key: "requirePhoto", label: "Фото" },
  { key: "requireVideo", label: "Видео" },
  { key: "requireSetsReps", label: "Подходы и повторения" },
  { key: "requireDuration", label: "Длительность" },
  { key: "requireMetricValue", label: "Значение показателя" },
  { key: "requireDifficulty", label: "Сложность (1–10)" },
  { key: "requireWellbeing", label: "Самочувствие (1–5)" },
];

const INITIAL_REQUIREMENTS = {
  requireComment: false,
  requirePhoto: false,
  requireVideo: false,
  requireSetsReps: false,
  requireDuration: false,
  requireMetricValue: false,
  requireDifficulty: false,
  requireWellbeing: false,
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskForm({ token, teamId, initial, prefill, onSaved, onCancel }: TaskFormProps) {
  const isEdit = initial !== undefined;
  const seed = initial ?? prefill;

  const [title, setTitle] = useState(seed?.title ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  const [planId, setPlanId] = useState(seed?.planId ?? "");
  const [exerciseIds, setExerciseIds] = useState<string[]>(seed?.exercises.map((e) => e.exerciseId) ?? []);
  const [deadline, setDeadline] = useState(toDatetimeLocal(initial?.deadline ?? null));
  const [metricName, setMetricName] = useState(seed?.metricName ?? "");
  const [metricUnit, setMetricUnit] = useState(seed?.metricUnit ?? "");
  const [metricTarget, setMetricTarget] = useState(seed?.metricTarget?.toString() ?? "");
  const [requirements, setRequirements] = useState({
    requireComment: seed?.requireComment ?? false,
    requirePhoto: seed?.requirePhoto ?? false,
    requireVideo: seed?.requireVideo ?? false,
    requireSetsReps: seed?.requireSetsReps ?? false,
    requireDuration: seed?.requireDuration ?? false,
    requireMetricValue: seed?.requireMetricValue ?? false,
    requireDifficulty: seed?.requireDifficulty ?? false,
    requireWellbeing: seed?.requireWellbeing ?? false,
  });

  const [targetType, setTargetType] = useState<TaskTargetType>("team");
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [position, setPosition] = useState("");
  const [trainingId, setTrainingId] = useState("");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGoal, setAiGoal] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFillSignal, setAiFillSignal] = useState(0);

  const handleAiGenerate = async () => {
    if (!aiGoal.trim()) {
      setAiError("Опишите цель задания для ИИ.");
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const draft = await createTaskDraft(token, teamId, { goal: aiGoal.trim() });
      setTitle(draft.title);
      setDescription(draft.description);
      setMetricName(draft.metricName ?? "");
      setMetricUnit(draft.metricUnit ?? "");
      setMetricTarget(draft.metricTarget?.toString() ?? "");
      setRequirements({
        requireComment: draft.requireComment,
        requirePhoto: draft.requirePhoto,
        requireVideo: draft.requireVideo,
        requireSetsReps: draft.requireSetsReps,
        requireDuration: draft.requireDuration,
        requireMetricValue: draft.requireMetricValue,
        requireDifficulty: draft.requireDifficulty,
        requireWellbeing: draft.requireWellbeing,
      });
      setTargetType(draft.targetType);
      if (draft.targetType === "position" && draft.targetPosition) setPosition(draft.targetPosition);
      setShowAiPanel(false);
      setAiFillSignal((s) => s + 1);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "Не удалось сформировать черновик");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    listMyPlans(token).then(setPlans).catch(() => setPlans([]));
    listMyExercises(token).then(setExercises).catch(() => setExercises([]));
    listMembers(token, teamId).then(setMembers).catch(() => setMembers([]));
    if (!isEdit) {
      listTeamTrainings(token, teamId).then(setTrainings).catch(() => setTrainings([]));
    }
  }, [token, teamId, isEdit]);

  const selectedExercises = exerciseIds
    .map((id) => exercises.find((e) => e.id === id))
    .filter((e): e is Exercise => e !== undefined);

  const assignableMembers = members.filter((m) => m.role === "player" || m.role === "captain");
  const positions = Array.from(new Set(assignableMembers.map((m) => m.position).filter((p): p is string => !!p)));

  const toggleExercise = (id: string) => {
    setExerciseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const togglePlayer = (id: string) => {
    setPlayerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const commonFields = {
        title: title.trim(),
        description: description.trim() || null,
        plan_id: planId || null,
        exercise_ids: exerciseIds,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        metric_name: metricName.trim() || null,
        metric_unit: metricUnit.trim() || null,
        metric_target: metricTarget ? Number(metricTarget) : null,
        require_comment: requirements.requireComment,
        require_photo: requirements.requirePhoto,
        require_video: requirements.requireVideo,
        require_sets_reps: requirements.requireSetsReps,
        require_duration: requirements.requireDuration,
        require_metric_value: requirements.requireMetricValue,
        require_difficulty: requirements.requireDifficulty,
        require_wellbeing: requirements.requireWellbeing,
      };

      if (isEdit && initial) {
        const task = await updateTask(token, initial.id, commonFields);
        onSaved(task);
        return;
      }

      const task = await createTask(token, teamId, {
        ...commonFields,
        target_type: targetType,
        player_ids: targetType === "players" ? playerIds : [],
        position: targetType === "position" ? position || null : null,
        training_id: targetType === "absentees" ? trainingId || null : null,
      });
      onSaved(task);
    } catch (err) {
      if (err instanceof ApiError && err.code === "no_recipients") {
        setError("Под выбранные условия не попал ни один игрок.");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить задание");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>
          {isEdit ? "Настройки задания" : prefill ? `Новое задание из шаблона «${prefill.title}»` : "Новое задание"}
        </h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        {!isEdit && !prefill && !showAiPanel && (
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowAiPanel(true)}>
            <Icon name="sparkles" size={16} />
            Заполнить с помощью ИИ
          </button>
        )}

        {!isEdit && showAiPanel && (
          <div className={profileStyles.field} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
            <span className={profileStyles.label}>Цель задания для ИИ</span>
            <textarea
              className={profileStyles.textarea}
              value={aiGoal}
              onChange={(e) => setAiGoal(e.target.value)}
              placeholder="Например: улучшить точность коротких передач"
              maxLength={1000}
            />
            <p className={profileStyles.requiredHint}>
              ИИ предложит формулировку, формат подтверждения и подскажет, кому назначить — вы сможете всё изменить
              перед созданием задания.
            </p>
            {aiError && <p className={profileStyles.error}>{aiError}</p>}
            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleAiGenerate()} disabled={aiLoading}>
                {aiLoading ? "Формирую…" : "Сформировать задание"}
              </button>
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowAiPanel(false)} disabled={aiLoading}>
                Отмена
              </button>
            </div>
          </div>
        )}

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Название<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={150} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

        <CollapsibleSection label="Детали" defaultOpen={isEdit || seed !== undefined}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Дедлайн</span>
            <input className={profileStyles.input} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>План тренировки</span>
            <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Без плана</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        </CollapsibleSection>

        {exercises.length > 0 && (
          <CollapsibleSection label="Упражнения" defaultOpen={isEdit || seed !== undefined}>
            <div className={profileStyles.field}>
              <span className={profileStyles.label}>Упражнения</span>
              {exercises.map((exercise) => (
                <label key={exercise.id} className={libraryStyles.pickerRow} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderBottom: "none", padding: "4px 0" }}>
                  <input type="checkbox" checked={exerciseIds.includes(exercise.id)} onChange={() => toggleExercise(exercise.id)} />
                  <span>{exercise.name}</span>
                </label>
              ))}
            </div>

            {selectedExercises.length > 1 && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Порядок выполнения</span>
                <DragReorderList
                  items={selectedExercises}
                  keyFn={(e) => e.id}
                  onReorder={(next) => setExerciseIds(next.map((e) => e.id))}
                  renderItem={(e) => <span>{e.name}</span>}
                />
              </div>
            )}
          </CollapsibleSection>
        )}

        <CollapsibleSection label="Формат подтверждения" defaultOpen={isEdit || seed !== undefined} forceOpenKey={aiFillSignal}>
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Формат подтверждения</span>
            {REQUIREMENT_FIELDS.map((field) => (
              <label key={field.key} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <input
                  type="checkbox"
                  checked={requirements[field.key]}
                  onChange={(e) => setRequirements((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>

          {requirements.requireMetricValue && (
            <div className={profileStyles.fieldGrid}>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Показатель</span>
                <input className={profileStyles.input} value={metricName} onChange={(e) => setMetricName(e.target.value)} maxLength={100} placeholder="Точность передач" />
              </label>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Единица</span>
                <input className={profileStyles.input} value={metricUnit} onChange={(e) => setMetricUnit(e.target.value)} maxLength={30} placeholder="%" />
              </label>
            </div>
          )}
          {requirements.requireMetricValue && (
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Целевое значение</span>
              <input className={profileStyles.input} type="number" value={metricTarget} onChange={(e) => setMetricTarget(e.target.value)} />
            </label>
          )}
        </CollapsibleSection>

        {!isEdit && (
          <>
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>
                Кому назначить<span className={profileStyles.requiredMark}>*</span>
              </span>
              <select className={profileStyles.select} value={targetType} onChange={(e) => setTargetType(e.target.value as TaskTargetType)}>
                <option value="team">Всей команде</option>
                <option value="players">Выбранным игрокам</option>
                <option value="position">Игрокам по позиции</option>
                <option value="absentees">Пропустившим тренировку</option>
              </select>
            </label>

            {targetType === "players" && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Игроки</span>
                {assignableMembers.map((member) => (
                  <label key={member.userId} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <input type="checkbox" checked={playerIds.includes(member.userId)} onChange={() => togglePlayer(member.userId)} />
                    <span>
                      {member.firstName} {member.lastName ?? ""}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {targetType === "position" && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Позиция</span>
                <input
                  className={profileStyles.input}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  list="task-position-suggestions"
                  placeholder="Вратарь"
                />
                <datalist id="task-position-suggestions">
                  {positions.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
            )}

            {targetType === "absentees" && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Тренировка</span>
                <select className={profileStyles.select} value={trainingId} onChange={(e) => setTrainingId(e.target.value)}>
                  <option value="">Выберите тренировку</option>
                  {trainings
                    .filter((t) => t.type === "team" || t.type === "independent")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.trainingDate} · {t.startTime.slice(0, 5)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        )}

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать задание"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
