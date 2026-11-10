import { useEffect, useState, type FormEvent } from "react";
import { addPlanExercise, createPlan, updatePlan } from "../../api/plans";
import { listMyExercises } from "../../api/exercises";
import { createTrainingPlanDraft } from "../../api/ai";
import { ApiError } from "../../api/client";
import type { Exercise } from "../../types/exercise";
import { PLAN_SECTIONS, PLAN_SECTION_LABELS, type Plan, type PlanInput, type PlanSection } from "../../types/plan";
import { Icon } from "../shared/Icon";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import { SportSelect } from "../shared/SportSelect";
import profileStyles from "../profile/profile.module.css";
import aiStyles from "../stats/stats.module.css";

interface PlanFormProps {
  token: string;
  initial?: Plan;
  onSaved: (plan: Plan) => void;
  onCancel: () => void;
}

export function PlanForm({ token, initial, onSaved, onCancel }: PlanFormProps) {
  const isEdit = initial !== undefined;
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [durationMinutes, setDurationMinutes] = useState(initial?.durationMinutes?.toString() ?? "");
  const [equipment, setEquipment] = useState(initial?.equipment ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // While a plan is being created its parts (разминка, основная, игровая, заминка) can be filled at once: the exercises picked here
  // are saved together with the plan.
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [picked, setPicked] = useState<Record<PlanSection, Exercise[]>>({ warmup: [], main: [], game: [], cooldown: [] });
  useEffect(() => {
    if (isEdit) return;
    listMyExercises(token)
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, [token, isEdit]);
  const addPicked = (section: PlanSection, exerciseId: string) => {
    const exercise = library.find((item) => item.id === exerciseId);
    if (!exercise) return;
    setPicked((prev) => (prev[section].some((item) => item.id === exerciseId) ? prev : { ...prev, [section]: [...prev[section], exercise] }));
  };
  const removePicked = (section: PlanSection, exerciseId: string) =>
    setPicked((prev) => ({ ...prev, [section]: prev[section].filter((item) => item.id !== exerciseId) }));

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGoals, setAiGoals] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFillSignal, setAiFillSignal] = useState(0);

  const handleAiGenerate = async () => {
    if (!aiGoals.trim()) {
      setAiError("Опишите цель тренировки для ИИ.");
      return;
    }
    setAiError(null);
    setAiLoading(true);
    try {
      const draft = await createTrainingPlanDraft(token, {
        goals: aiGoals.trim(),
        sport: sport.trim() || null,
        duration_minutes: durationMinutes ? Number(durationMinutes) : null,
        equipment: equipment.trim() || null,
      });
      setName(draft.name);
      setSport(draft.sport);
      setDescription(draft.description);
      if (draft.durationMinutes !== null) setDurationMinutes(draft.durationMinutes.toString());
      if (draft.equipment) setEquipment(draft.equipment);
      if (draft.comment) setComment(draft.comment);
      setShowAiPanel(false);
      setAiFillSignal((s) => s + 1);
    } catch (err) {
      if (err instanceof ApiError && err.code === "coach_profile_required") {
        setAiError("Сначала заполните профиль тренера в разделе «Профиль».");
      } else {
        setAiError(err instanceof ApiError ? err.message : "Не удалось сформировать черновик");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: PlanInput = {
        sport: sport.trim(),
        name: name.trim(),
        description: description.trim() || null,
        duration_minutes: durationMinutes ? Number(durationMinutes) : null,
        equipment: equipment.trim() || null,
        comment: comment.trim() || null,
      };
      const plan = isEdit && initial ? await updatePlan(token, initial.id, input) : await createPlan(token, input);
      if (!isEdit) {
        // If one of the exercises cannot be added the plan still exists: the coach finishes it on its own screen.
        for (const section of PLAN_SECTIONS) {
          for (const [index, exercise] of picked[section].entries()) {
            await addPlanExercise(token, plan.id, {
              exercise_id: exercise.id,
              section,
              order_index: index,
              sets: exercise.sets,
              reps: exercise.reps,
              duration_seconds: exercise.durationSeconds,
              rest_seconds: exercise.restSeconds,
              notes: null,
            }).catch(() => undefined);
          }
        }
      }
      onSaved(plan);
    } catch (err) {
      if (err instanceof ApiError && err.code === "coach_profile_required") {
        setError("Сначала заполните профиль тренера в разделе «Профиль».");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить план");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>{isEdit ? "Настройки плана" : "Новый план тренировки"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        {!isEdit && !showAiPanel && (
          <button type="button" className={aiStyles.aiTeaser} style={{ cursor: "pointer", font: "inherit", textAlign: "left" }} onClick={() => setShowAiPanel(true)}>
            <span className={aiStyles.aiTeaserIcon}>
              <Icon name="sparkles" size={20} />
            </span>
            <span className={aiStyles.aiTeaserText}>
              <b>Заполнить с помощью ИИ</b> — опишите цель, остальное предложит ИИ
            </span>
            <span className={aiStyles.aiTeaserButton}>Заполнить</span>
          </button>
        )}

        {!isEdit && showAiPanel && (
          <div className={aiStyles.aiCard}>
            <div className={aiStyles.aiCardHead}>
              <Icon name="sparkles" size={18} />
              <span className={aiStyles.aiCardTitle}>План с ИИ</span>
            </div>
            <span className={profileStyles.label}>Цель тренировки для ИИ</span>
            <textarea
              className={profileStyles.textarea}
              value={aiGoals}
              onChange={(e) => setAiGoals(e.target.value)}
              placeholder="Например: развитие командной игры в обороне"
              maxLength={1000}
            />
            <p className={profileStyles.requiredHint}>
              ИИ учтёт вид спорта, длительность и инвентарь, если вы их уже заполнили. Результат — черновик, который
              можно отредактировать перед сохранением.
            </p>
            {aiError && <p className={profileStyles.error}>{aiError}</p>}
            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleAiGenerate()} disabled={aiLoading}>
                {aiLoading ? "Формирую…" : "Сформировать план"}
              </button>
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowAiPanel(false)} disabled={aiLoading}>
                Отмена
              </button>
            </div>
          </div>
        )}

        <SportSelect value={sport} onChange={setSport} />

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Название<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

        <CollapsibleSection label="Дополнительно" defaultOpen={isEdit} forceOpenKey={aiFillSignal}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Длительность, мин</span>
            <input
              className={profileStyles.input}
              type="number"
              min={0}
              max={600}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Инвентарь</span>
            <input className={profileStyles.input} value={equipment} onChange={(e) => setEquipment(e.target.value)} maxLength={500} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Комментарий</span>
            <textarea className={profileStyles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          </label>
        </CollapsibleSection>

        {!isEdit && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Из чего состоит тренировка</span>
            <p className={profileStyles.requiredHint}>
              Выберите упражнения из своей библиотеки для каждой части — подходы и повторы возьмутся из упражнения, их можно поменять в плане.
            </p>
            {PLAN_SECTIONS.map((section) => (
              <div key={section} style={{ marginTop: 8 }}>
                <strong>{PLAN_SECTION_LABELS[section]}</strong>
                {picked[section].map((exercise) => (
                  <div key={exercise.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                    <span>{exercise.name}</span>
                    <button type="button" className={profileStyles.buttonSecondary} onClick={() => removePicked(section, exercise.id)}>
                      Убрать
                    </button>
                  </div>
                ))}
                {library.length === 0 ? (
                  <p className={profileStyles.subtitle}>В библиотеке пока нет упражнений — их можно будет добавить в план позже.</p>
                ) : (
                  <select
                    className={profileStyles.select}
                    aria-label={`Добавить упражнение: ${PLAN_SECTION_LABELS[section]}`}
                    value=""
                    onChange={(e) => addPicked(section, e.target.value)}
                  >
                    <option value="">+ Добавить упражнение</option>
                    {library
                      .filter((exercise) => !picked[section].some((item) => item.id === exercise.id))
                      .map((exercise) => (
                        <option key={exercise.id} value={exercise.id}>
                          {exercise.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать план"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
