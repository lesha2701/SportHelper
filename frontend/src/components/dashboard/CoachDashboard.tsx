// frontend/src/components/dashboard/CoachDashboard.tsx
import { useCallback, useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { getCalendar } from "../../api/calendar";
import { getTeamStats } from "../../api/stats";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import type { Team } from "../../types/team";
import { formatRate, type TeamStats } from "../../types/stats";
import styles from "./dashboard.module.css";
import teamStyles from "../teams/teams.module.css";

const COACH_STAFF_ROLES = new Set<string>(["head_coach", "assistant_coach"]);

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; teams: Team[]; events: CalendarEvent[] };

type StatsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: TeamStats };

export function CoachDashboard({
  token,
  onOpenEvent,
  onOpenTeam,
}: {
  token: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [statsState, setStatsState] = useState<StatsState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([listMyTeams(token), getCalendar(token, isoDatePlusDays(0), isoDatePlusDays(14))])
      .then(([teams, events]) => {
        const coachTeams = teams.filter((t) => t.myRole && COACH_STAFF_ROLES.has(t.myRole));
        if (coachTeams.length === 0) {
          setState({ status: "empty" });
          return;
        }
        setState({ status: "ready", teams: coachTeams, events });
        setSelectedTeamId((current) => current ?? coachTeams[0]!.id);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить данные";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!selectedTeamId) return;
    setStatsState({ status: "loading" });
    getTeamStats(token, selectedTeamId)
      .then((stats) => setStatsState({ status: "ready", stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить статистику";
        setStatsState({ status: "error", message });
      });
  }, [token, selectedTeamId]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить главную" description={state.message} onRetry={load} />;
  }
  if (state.status === "empty") {
    return (
      <StateScreen
        kind="empty"
        title="Пока нет команд"
        description="Создайте команду на вкладке «Команды», чтобы видеть здесь тренировки, нагрузку и задачи."
      />
    );
  }

  const { teams, events } = state;
  const today = isoDatePlusDays(0);
  const nextEvent = events.find((e) => e.date >= today);
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0]!;

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Тренерская панель</h1>
      </div>

      {nextEvent ? (
        <button type="button" className={styles.nextEventCard} onClick={() => onOpenEvent(nextEvent)}>
          <Icon name={CALENDAR_EVENT_ICONS[nextEvent.type]} size={22} />
          <div className={styles.nextEventText}>
            <span className={styles.nextEventLabel}>Ближайшее</span>
            <span className={styles.nextEventTitle}>{nextEvent.title}</span>
            <span className={styles.nextEventMeta}>
              {nextEvent.date}
              {nextEvent.time ? ` · ${nextEvent.time}` : ""}
              {nextEvent.teamName ? ` · ${nextEvent.teamName}` : ""}
            </span>
          </div>
          <Icon name="chevron-right" size={18} />
        </button>
      ) : (
        <p className={styles.emptyHint}>Ближайших событий нет.</p>
      )}

      {teams.length > 1 && (
        <div className={styles.teamSwitcher}>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className={team.id === selectedTeamId ? styles.chipActive : styles.chip}
              onClick={() => setSelectedTeamId(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {statsState.status === "ready" && (
        <div className={styles.kpiRow}>
          <StatTile value={formatRate(statsState.stats.attendanceRate)} label="Посещаемость" tone="dark" />
          <StatTile value={statsState.stats.trainingsUpcoming} label="Тренировок впереди" />
          <StatTile value={statsState.stats.tasksOverdue} label="Просрочено заданий" />
          <StatTile
            value={`${statsState.stats.matchesWon}-${statsState.stats.matchesLost}-${statsState.stats.matchesDrawn}`}
            label="П-Пор-Н"
          />
        </div>
      )}
      {statsState.status === "loading" && <p className={styles.emptyHint}>Загрузка статистики…</p>}
      {statsState.status === "error" && <p className={styles.emptyHint}>{statsState.message}</p>}

      <button type="button" className={teamStyles.navRow} onClick={() => onOpenTeam(selectedTeam.id)}>
        <span className={teamStyles.navRowIcon}>
          <Icon name="trophy" size={18} />
        </span>
        <span className={teamStyles.navRowLabel}>Открыть «{selectedTeam.name}»</span>
        <span className={teamStyles.navRowChevron}>
          <Icon name="chevron-right" size={18} />
        </span>
      </button>
    </div>
  );
}
