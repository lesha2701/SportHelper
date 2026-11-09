import { useEffect, useState, type FormEvent } from "react";
import { createMatch, updateMatch } from "../../api/matches";
import { getTeam } from "../../api/teams";
import { ApiError } from "../../api/client";
import type { Match } from "../../types/match";
import profileStyles from "../profile/profile.module.css";
import { navigateApp } from "../../appNav";
import { toast } from "../../toast";

interface MatchFormProps {
  token: string;
  teamId: string;
  initial?: Match;
  onSaved: (match: Match) => void;
  onCancel: () => void;
}

export function MatchForm({ token, teamId, initial, onSaved, onCancel }: MatchFormProps) {
  const isEdit = initial !== undefined;

  const [opponentName, setOpponentName] = useState(initial?.opponentName ?? "");
  const [matchDate, setMatchDate] = useState(initial?.matchDate ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime?.slice(0, 5) ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [isHome, setIsHome] = useState(initial?.isHome ?? true);
  const [tournament, setTournament] = useState(initial?.tournament ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The team's settings: its tournaments are offered, and a home match of a new match takes the home venue as its place.
  const [tournaments, setTournaments] = useState<string[]>([]);
  const [homeVenue, setHomeVenue] = useState<string | null>(null);
  const [locationTouched, setLocationTouched] = useState(isEdit);
  useEffect(() => {
    getTeam(token, teamId)
      .then((team) => {
        setTournaments(team.tournaments);
        setHomeVenue(team.homeVenue);
      })
      .catch(() => undefined);
  }, [token, teamId]);
  useEffect(() => {
    if (!locationTouched && isHome && homeVenue) setLocation(homeVenue);
    if (!locationTouched && !isHome) setLocation("");
  }, [homeVenue, isHome, locationTouched]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const commonFields = {
        opponent_name: opponentName.trim(),
        match_date: matchDate,
        start_time: `${startTime}:00`,
        location: location.trim() || null,
        is_home: isHome,
        tournament: tournament.trim() || null,
      };

      if (isEdit && initial) {
        const match = await updateMatch(token, initial.id, { ...commonFields, status: initial.status });
        onSaved(match);
        return;
      }

      const match = await createMatch(token, teamId, commonFields);
      toast.success("Матч создан", { label: "Посмотреть в календаре", onClick: () => navigateApp({ kind: "tab", tab: "calendar" }) });
      onSaved(match);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить матч");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>{isEdit ? "Редактировать матч" : "Новый матч"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Соперник<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} value={opponentName} onChange={(e) => setOpponentName(e.target.value)} required maxLength={150} />
        </label>

        <div className={profileStyles.fieldGrid}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Дата<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input className={profileStyles.input} type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} required />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Время<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input className={profileStyles.input} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </label>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Место</span>
          <input
            className={profileStyles.input}
            value={location}
            onChange={(e) => {
              setLocationTouched(true);
              setLocation(e.target.value);
            }}
            maxLength={200}
          />
          {homeVenue && !isEdit && (
            <span className={profileStyles.requiredHint}>Для домашнего матча подставляется домашняя площадка команды: {homeVenue}.</span>
          )}
        </label>

        <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={isHome} onChange={(e) => setIsHome(e.target.checked)} />
          <span className={profileStyles.label}>Домашний матч</span>
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Турнир</span>
          <input
            className={profileStyles.input}
            list="team-tournaments"
            value={tournament}
            onChange={(e) => setTournament(e.target.value)}
            maxLength={150}
          />
          <datalist id="team-tournaments">
            {tournaments.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <span className={profileStyles.requiredHint}>
            {tournaments.length > 0
              ? "Выберите из турниров команды или впишите свой."
              : "Турниры команды можно задать в настройках команды — тогда их можно будет выбирать здесь."}
          </span>
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать матч"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
