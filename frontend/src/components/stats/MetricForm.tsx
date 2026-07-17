import { useState, type FormEvent } from "react";
import { createMetric, updateMetric } from "../../api/metrics";
import { ApiError } from "../../api/client";
import type { Metric } from "../../types/metric";
import profileStyles from "../profile/profile.module.css";

export function MetricForm({
  token,
  userId,
  initial,
  onSaved,
  onCancel,
}: {
  token: string;
  userId: string;
  initial?: Metric;
  onSaved: (metric: Metric) => void;
  onCancel: () => void;
}) {
  const isEdit = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [value, setValue] = useState(initial?.value?.toString() ?? "");
  const [recordedDate, setRecordedDate] = useState(initial?.recordedDate ?? new Date().toISOString().slice(0, 10));
  const [higherIsBetter, setHigherIsBetter] = useState(initial?.higherIsBetter ?? true);
  const [source, setSource] = useState(initial?.source ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        unit: unit.trim() || null,
        value: Number(value),
        recorded_date: recordedDate,
        higher_is_better: higherIsBetter,
        source: source.trim() || null,
        comment: comment.trim() || null,
      };
      const metric = isEdit && initial ? await updateMetric(token, initial.id, input) : await createMetric(token, userId, input);
      onSaved(metric);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить показатель");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.card} onSubmit={handleSubmit}>
      <h2 className={profileStyles.title}>{isEdit ? "Изменить показатель" : "Новый показатель"}</h2>

      <label className={profileStyles.field}>
        <span className={profileStyles.label}>
          Название<span className={profileStyles.requiredMark}>*</span>
        </span>
        <input className={profileStyles.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} placeholder="Попадания из 50" />
      </label>

      <div className={profileStyles.fieldGrid}>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Значение<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
        </label>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Единица</span>
          <input className={profileStyles.input} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} placeholder="шт, см, сек" />
        </label>
      </div>

      <label className={profileStyles.field}>
        <span className={profileStyles.label}>
          Дата<span className={profileStyles.requiredMark}>*</span>
        </span>
        <input className={profileStyles.input} type="date" value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} required />
      </label>

      <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={higherIsBetter} onChange={(e) => setHigherIsBetter(e.target.checked)} />
        <span className={profileStyles.label}>Больше — лучше</span>
      </label>

      <label className={profileStyles.field}>
        <span className={profileStyles.label}>Источник</span>
        <input className={profileStyles.input} value={source} onChange={(e) => setSource(e.target.value)} maxLength={150} placeholder="Тренировка, тестирование, матч" />
      </label>

      <label className={profileStyles.field}>
        <span className={profileStyles.label}>Комментарий</span>
        <textarea className={profileStyles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </label>

      {error && <p className={profileStyles.error}>{error}</p>}

      <div className={profileStyles.formActions}>
        <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
          Отмена
        </button>
      </div>
    </form>
  );
}
