import { useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { COMMON_SPORTS, SKILL_LEVEL_LABELS, type PlayerProfile, type PlayerProfileInput, type SkillLevel } from "../../types/profile";
import styles from "./profile.module.css";

interface PlayerProfileFormProps {
  initial: PlayerProfile | null;
  onSubmit: (input: PlayerProfileInput) => Promise<void>;
  onCancel?: () => void;
}

export function PlayerProfileForm({ initial, onSubmit, onCancel }: PlayerProfileFormProps) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [age, setAge] = useState(initial?.age?.toString() ?? "");
  const [heightCm, setHeightCm] = useState(initial?.heightCm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(initial?.weightKg?.toString() ?? "");
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [level, setLevel] = useState<SkillLevel | "">(initial?.level ?? "");
  const [goals, setGoals] = useState(initial?.goals ?? "");
  const [loadRestrictions, setLoadRestrictions] = useState(initial?.loadRestrictions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        full_name: fullName.trim(),
        age: age ? Number(age) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        weight_kg: weightKg ? Number(weightKg) : null,
        sport: sport.trim(),
        position: position.trim() || null,
        level: level || null,
        goals: goals.trim() || null,
        load_restrictions: loadRestrictions.trim() || null,
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
        <h1 className={styles.pageHeading}>Профиль игрока</h1>
        <p className={styles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        <span className={styles.fieldSectionLabel}>Основное</span>

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

        <span className={styles.fieldSectionLabel}>Физические данные</span>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Возраст</span>
            <input
              className={styles.input}
              type="number"
              min={3}
              max={100}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Рост, см</span>
            <input
              className={styles.input}
              type="number"
              min={50}
              max={260}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Вес, кг</span>
            <input
              className={styles.input}
              type="number"
              min={15}
              max={300}
              step="0.1"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Уровень</span>
            <select
              className={styles.select}
              value={level}
              onChange={(e) => setLevel(e.target.value as SkillLevel | "")}
            >
              <option value="">Не указан</option>
              {Object.entries(SKILL_LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <span className={styles.fieldSectionLabel}>Спорт</span>

        <label className={styles.field}>
          <span className={styles.label}>
            Вид спорта<span className={styles.requiredMark}>*</span>
          </span>
          <input
            className={styles.input}
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            list="sports-suggestions"
            required
            maxLength={50}
          />
          <datalist id="sports-suggestions">
            {COMMON_SPORTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Игровая позиция</span>
          <input
            className={styles.input}
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            maxLength={50}
          />
        </label>

        <span className={styles.fieldSectionLabel}>Цели и ограничения</span>

        <label className={styles.field}>
          <span className={styles.label}>Цели</span>
          <textarea
            className={styles.textarea}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            maxLength={1000}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Ограничения по нагрузке</span>
          <textarea
            className={styles.textarea}
            value={loadRestrictions}
            onChange={(e) => setLoadRestrictions(e.target.value)}
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
