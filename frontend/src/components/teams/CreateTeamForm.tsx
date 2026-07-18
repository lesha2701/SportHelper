import { useState, type FormEvent } from "react";
import { createTeam, updateTeam } from "../../api/teams";
import { ApiError } from "../../api/client";
import { COMMON_SPORTS, SKILL_LEVEL_LABELS, type SkillLevel } from "../../types/profile";
import type { Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";

interface CreateTeamFormProps {
  token: string;
  initial?: Team;
  onCreated: (team: Team) => void;
  onCancel: () => void;
}

export function CreateTeamForm({ token, initial, onCreated, onCancel }: CreateTeamFormProps) {
  const isEdit = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [ageCategory, setAgeCategory] = useState(initial?.ageCategory ?? "");
  const [level, setLevel] = useState<SkillLevel | "">(initial?.level ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || null,
        sport: sport.trim(),
        age_category: ageCategory.trim() || null,
        level: level || null,
      };
      const team = isEdit && initial ? await updateTeam(token, initial.id, input) : await createTeam(token, input);
      onCreated(team);
    } catch (err) {
      if (err instanceof ApiError && err.code === "coach_profile_required") {
        setError("Сначала заполните профиль тренера в разделе «Профиль».");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить команду");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>{isEdit ? "Настройки команды" : "Новая команда"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Название<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input
            className={profileStyles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Вид спорта<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input
            className={profileStyles.input}
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            list="team-sports-suggestions"
            required
            maxLength={50}
          />
          <datalist id="team-sports-suggestions">
            {COMMON_SPORTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <div className={profileStyles.fieldGrid}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Возрастная категория</span>
            <input
              className={profileStyles.input}
              value={ageCategory}
              onChange={(e) => setAgeCategory(e.target.value)}
              placeholder="напр. U-16"
              maxLength={50}
            />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Уровень</span>
            <select
              className={profileStyles.select}
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

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea
            className={profileStyles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
          />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать команду"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
