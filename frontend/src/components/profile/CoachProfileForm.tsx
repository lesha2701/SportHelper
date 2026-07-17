import { useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { COMMON_SPORTS, type CoachProfile, type CoachProfileInput } from "../../types/profile";
import styles from "./profile.module.css";

interface CoachProfileFormProps {
  initial: CoachProfile | null;
  onSubmit: (input: CoachProfileInput) => Promise<void>;
  onCancel?: () => void;
}

export function CoachProfileForm({ initial, onSubmit, onCancel }: CoachProfileFormProps) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [experienceYears, setExperienceYears] = useState(initial?.experienceYears?.toString() ?? "");
  const [specialization, setSpecialization] = useState(initial?.specialization ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        full_name: fullName.trim(),
        sport: sport.trim(),
        experience_years: experienceYears ? Number(experienceYears) : null,
        specialization: specialization.trim() || null,
        description: description.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить профиль");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.screen} onSubmit={handleSubmit}>
      <div className={styles.card}>
        <h1 className={styles.title}>Профиль тренера</h1>
        <p className={styles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        <label className={styles.field}>
          <span className={styles.label}>
            Имя<span className={styles.requiredMark}>*</span>
          </span>
          <input
            className={styles.input}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={100}
          />
        </label>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>
              Вид спорта<span className={styles.requiredMark}>*</span>
            </span>
            <input
              className={styles.input}
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              list="sports-suggestions-coach"
              required
              maxLength={50}
            />
            <datalist id="sports-suggestions-coach">
              {COMMON_SPORTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Опыт, лет</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={80}
              value={experienceYears}
              onChange={(e) => setExperienceYears(e.target.value)}
            />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Специализация</span>
          <input
            className={styles.input}
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
            maxLength={200}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Описание</span>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.formActions}>
          <button type="submit" className={styles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          {onCancel && (
            <button type="button" className={styles.buttonSecondary} onClick={onCancel} disabled={saving}>
              Отмена
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
