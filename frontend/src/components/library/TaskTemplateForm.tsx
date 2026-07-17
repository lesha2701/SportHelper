import { useEffect, useState, type FormEvent } from "react";
import { createTemplate, updateTemplate } from "../../api/taskTemplates";
import { listMyExercises } from "../../api/exercises";
import { listMyPlans } from "../../api/plans";
import { ApiError } from "../../api/client";
import type { Exercise } from "../../types/exercise";
import type { Plan } from "../../types/plan";
import type { TaskTemplate } from "../../types/taskTemplate";
import profileStyles from "../profile/profile.module.css";

interface TaskTemplateFormProps {
  token: string;
  initial?: TaskTemplate;
  onSaved: (template: TaskTemplate) => void;
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

export function TaskTemplateForm({ token, initial, onSaved, onCancel }: TaskTemplateFormProps) {
  const isEdit = initial !== undefined;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [planId, setPlanId] = useState(initial?.planId ?? "");
  const [exerciseIds, setExerciseIds] = useState<string[]>(initial?.exercises.map((e) => e.exerciseId) ?? []);
  const [metricName, setMetricName] = useState(initial?.metricName ?? "");
  const [metricUnit, setMetricUnit] = useState(initial?.metricUnit ?? "");
  const [metricTarget, setMetricTarget] = useState(initial?.metricTarget?.toString() ?? "");
  const [requirements, setRequirements] = useState({
    requireComment: initial?.requireComment ?? false,
    requirePhoto: initial?.requirePhoto ?? false,
    requireVideo: initial?.requireVideo ?? false,
    requireSetsReps: initial?.requireSetsReps ?? false,
    requireDuration: initial?.requireDuration ?? false,
    requireMetricValue: initial?.requireMetricValue ?? false,
    requireDifficulty: initial?.requireDifficulty ?? false,
    requireWellbeing: initial?.requireWellbeing ?? false,
  });

  const [plans, setPlans] = useState<Plan[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listMyPlans(token).then(setPlans).catch(() => setPlans([]));
    listMyExercises(token).then(setExercises).catch(() => setExercises([]));
  }, [token]);

  const toggleExercise = (id: string) => {
    setExerciseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        plan_id: planId || null,
        exercise_ids: exerciseIds,
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
      const template = isEdit && initial ? await updateTemplate(token, initial.id, input) : await createTemplate(token, input);
      onSaved(template);
    } catch (err) {
      if (err instanceof ApiError && err.code === "coach_profile_required") {
        setError("Сначала заполните профиль тренера в разделе «Профиль».");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить шаблон");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.title}>{isEdit ? "Настройки шаблона" : "Новый шаблон задания"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

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

        {exercises.length > 0 && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Упражнения</span>
            {exercises.map((exercise) => (
              <label key={exercise.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <input type="checkbox" checked={exerciseIds.includes(exercise.id)} onChange={() => toggleExercise(exercise.id)} />
                <span>{exercise.name}</span>
              </label>
            ))}
          </div>
        )}

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

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать шаблон"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
