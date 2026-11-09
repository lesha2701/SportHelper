import { useState, type FormEvent } from "react";
import { createTeam, updateTeam } from "../../api/teams";
import { ApiError } from "../../api/client";
import { SKILL_LEVEL_LABELS, type SkillLevel } from "../../types/profile";
import { SportSelect } from "../shared/SportSelect";
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
  // One tournament per line; the match form offers them, and a home match takes the home venue as its place.
  const [tournaments, setTournaments] = useState((initial?.tournaments ?? []).join("\n"));
  const [homeVenue, setHomeVenue] = useState(initial?.homeVenue ?? "");
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
        tournaments: tournaments.split("\n").map((line) => line.trim()).filter(Boolean),
        home_venue: homeVenue.trim() || null,
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

        <SportSelect value={sport} onChange={setSport} />

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

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Домашняя площадка</span>
          <input
            className={profileStyles.input}
            value={homeVenue}
            onChange={(e) => setHomeVenue(e.target.value)}
            placeholder="Стадион «Динамо»"
            maxLength={200}
          />
          <span className={profileStyles.requiredHint}>Подставится как место во всех домашних матчах команды.</span>
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Турниры команды</span>
          <textarea
            className={profileStyles.textarea}
            value={tournaments}
            onChange={(e) => setTournaments(e.target.value)}
            placeholder={"Кубок города\nЛига выходного дня"}
            rows={3}
          />
          <span className={profileStyles.requiredHint}>Каждый турнир с новой строки. В форме матча их можно выбрать из списка.</span>
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
