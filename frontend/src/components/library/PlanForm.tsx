import { useState, type FormEvent } from "react";
import { createPlan, updatePlan } from "../../api/plans";
import { createTrainingPlanDraft } from "../../api/ai";
import { ApiError } from "../../api/client";
import { COMMON_SPORTS } from "../../types/profile";
import type { Plan, PlanInput } from "../../types/plan";
import profileStyles from "../profile/profile.module.css";

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

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiGoals, setAiGoals] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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
        <h1 className={profileStyles.title}>{isEdit ? "Настройки плана" : "Новый план тренировки"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        {!isEdit && !showAiPanel && (
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowAiPanel(true)}>
            ✨ Заполнить с помощью ИИ
          </button>
        )}

        {!isEdit && showAiPanel && (
          <div className={profileStyles.field} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
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

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Название<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Вид спорта<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input
            className={profileStyles.input}
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            list="plan-sports-suggestions"
            required
            maxLength={50}
          />
          <datalist id="plan-sports-suggestions">
            {COMMON_SPORTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

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
