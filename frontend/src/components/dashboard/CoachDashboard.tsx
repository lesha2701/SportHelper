// frontend/src/components/dashboard/CoachDashboard.tsx
import { useCallback, useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { getCalendar } from "../../api/calendar";
import { getTeamStats } from "../../api/stats";
import { listTeamMatches } from "../../api/matches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import type { Team } from "../../types/team";
import type { PlayerActivity, TeamStats } from "../../types/stats";
import { formatRate } from "../../types/stats";
import type { Match } from "../../types/match";
import styles from "./dashboard.module.css";

const COACH_STAFF_ROLES = new Set<string>(["head_coach", "assistant_coach"]);
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WAVE_PATH = "M-20 90 C 60 40, 140 140, 220 60 S 380 20, 440 70";

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIso(d);
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

type MatchesState = { status: "loading" } | { status: "error" } | { status: "ready"; matches: Match[] };

export function CoachDashboard({
  token,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
}: {
  token: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [statsState, setStatsState] = useState<StatsState>({ status: "loading" });
  const [matchesState, setMatchesState] = useState<MatchesState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    const weekStart = toIso(startOfWeek(new Date()));
    Promise.all([listMyTeams(token), getCalendar(token, weekStart, isoDatePlusDays(13))])
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

  useEffect(() => {
    if (!selectedTeamId) return;
    setMatchesState({ status: "loading" });
    listTeamMatches(token, selectedTeamId)
      .then((matches) => setMatchesState({ status: "ready", matches }))
      .catch(() => setMatchesState({ status: "error" }));
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

  const weekStart = startOfWeek(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.date) ?? [];
    list.push(e);
    eventsByDay.set(e.date, list);
  }

  const attention: PlayerActivity[] =
    statsState.status === "ready"
      ? dedupeByUser([...statsState.stats.frequentAbsencePlayers, ...statsState.stats.lowActivityPlayers]).slice(0, 4)
      : [];

  const recentMatches =
    matchesState.status === "ready"
      ? matchesState.matches
          .filter((m) => m.status === "completed" && m.result !== null)
          .sort((a, b) => (a.matchDate < b.matchDate ? 1 : -1))
          .slice(0, 3)
      : [];

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Тренерская панель</h1>
      </div>

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

      <div className={styles.bento}>
        <button type="button" className={`${styles.heroCard} ${styles.span7}`} onClick={() => nextEvent && onOpenEvent(nextEvent)} disabled={!nextEvent}>
          <svg viewBox="0 0 400 120" preserveAspectRatio="none" className={styles.heroWave}>
            <path d={WAVE_PATH} stroke="#ff3b3f" strokeWidth="26" fill="none" strokeLinecap="round" />
          </svg>
          {nextEvent ? (
            <>
              <div className={styles.heroBadgeRow}>
                <span className={styles.heroBadge}>
                  {parseIsoDateLocal(nextEvent.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                  {nextEvent.time ? ` · ${nextEvent.time.slice(0, 5)}` : ""}
                </span>
                {nextEvent.teamName && <span className={styles.heroBadgeMeta}>{nextEvent.teamName}</span>}
              </div>
              <div className={styles.heroTitleRow}>
                <div>
                  <h2 className={styles.heroMainTitle}>{nextEvent.title}</h2>
                  <p className={styles.heroSubtitle}>Ближайшее событие</p>
                </div>
                <Icon name={CALENDAR_EVENT_ICONS[nextEvent.type]} size={28} />
              </div>
            </>
          ) : (
            <div className={styles.heroTitleRow}>
              <div>
                <h2 className={styles.heroMainTitle}>Нет ближайших событий</h2>
                <p className={styles.heroSubtitle}>Запланируйте тренировку или матч</p>
              </div>
            </div>
          )}
        </button>

        <div className={`${styles.kpiRow} ${styles.span5}`}>
          {statsState.status === "ready" ? (
            <>
              <StatTile value={formatRate(statsState.stats.attendanceRate)} label="Посещаемость" tone="dark" />
              <StatTile value={statsState.stats.trainingsUpcoming} label="Тренировок впереди" />
              <StatTile value={statsState.stats.tasksOverdue} label="Просрочено заданий" />
              <StatTile
                value={`${statsState.stats.matchesWon}-${statsState.stats.matchesDrawn}-${statsState.stats.matchesLost}`}
                label="Победы-ничьи-поражения"
              />
            </>
          ) : statsState.status === "error" ? (
            <p className={styles.emptyHint}>{statsState.message}</p>
          ) : (
            <p className={styles.emptyHint}>Загрузка статистики…</p>
          )}
        </div>

        <div className={`${styles.card} ${styles.span8}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Эта неделя</h3>
          </div>
          <div className={styles.weekGrid}>
            {weekDays.map((d) => {
              const iso = toIso(d);
              const isToday = iso === today;
              const dayEvents = (eventsByDay.get(iso) ?? []).slice(0, 3);
              return (
                <div key={iso} className={isToday ? `${styles.weekCol} ${styles.weekColToday}` : styles.weekCol}>
                  <div className={styles.weekColHead}>
                    <span className={styles.weekColWd}>{WEEKDAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]}</span>
                    <span className={isToday ? `${styles.weekColNum} ${styles.weekColNumToday}` : styles.weekColNum}>{d.getDate()}</span>
                  </div>
                  {dayEvents.map((e) => (
                    <button key={e.id} type="button" className={styles.weekEvent} onClick={() => onOpenEvent(e)}>
                      <span className={styles.weekEventTime}>{e.time ? e.time.slice(0, 5) : ""}</span>
                      <span className={styles.weekEventTitle}>{e.title}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className={`${styles.card} ${styles.span4}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Требуют внимания</h3>
            {attention.length > 0 && <span className={styles.heroBadgeMeta}>{attention.length}</span>}
          </div>
          {attention.length === 0 ? (
            <p className={styles.emptyHint}>Все в порядке.</p>
          ) : (
            <div className={styles.rowList}>
              {attention.map((p) => (
                <div key={p.userId} className={styles.attentionRow}>
                  <div className={styles.attentionAvatar}>{p.firstName.charAt(0).toUpperCase()}</div>
                  <div className={styles.attentionText}>
                    <span className={styles.attentionName}>
                      {p.firstName} {p.lastName ?? ""}
                    </span>
                    <span className={styles.attentionWhy}>{p.absentCount} пропусков</span>
                  </div>
                  <span className={styles.attentionRate}>{formatRate(p.attendanceRate)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${styles.card} ${styles.span5}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Нагрузка команды</h3>
          </div>
          {statsState.status === "ready" ? (
            <div className={styles.workloadGrid}>
              <div className={styles.workloadTile}>
                <span className={styles.workloadValue}>{statsState.stats.trainingsCompleted}</span>
                <span className={styles.workloadLabel}>Тренировок проведено</span>
              </div>
              <div className={styles.workloadTile}>
                <span className={styles.workloadValue}>
                  {statsState.stats.tasksCompleted}/{statsState.stats.tasksTotal}
                </span>
                <span className={styles.workloadLabel}>Заданий выполнено</span>
              </div>
              <div className={styles.workloadTile}>
                <span className={styles.workloadValue}>{statsState.stats.avgDifficulty ?? "—"}</span>
                <span className={styles.workloadLabel}>Средняя сложность</span>
              </div>
              <div className={styles.workloadTile}>
                <span className={styles.workloadValue}>{statsState.stats.avgWellbeing ?? "—"}</span>
                <span className={styles.workloadLabel}>Самочувствие</span>
              </div>
            </div>
          ) : (
            <p className={styles.emptyHint}>Загрузка…</p>
          )}
        </div>

        <div className={`${styles.card} ${styles.span4}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Последние матчи</h3>
          </div>
          {recentMatches.length === 0 ? (
            <p className={styles.emptyHint}>Пока нет сыгранных матчей.</p>
          ) : (
            <div className={styles.rowList}>
              {recentMatches.map((m) => (
                <div key={m.id} className={styles.matchRow}>
                  <span
                    className={
                      m.result === "win"
                        ? `${styles.matchResult} ${styles.matchResultWin}`
                        : m.result === "loss"
                          ? `${styles.matchResult} ${styles.matchResultLoss}`
                          : `${styles.matchResult} ${styles.matchResultDraw}`
                    }
                  >
                    {m.result === "win" ? "В" : m.result === "loss" ? "П" : "Н"}
                  </span>
                  <div className={styles.matchText}>
                    <span className={styles.matchOpp}>{m.opponentName}</span>
                    <span className={styles.matchDate}>
                      {parseIsoDateLocal(m.matchDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                      {m.isHome ? " · дома" : " · выезд"}
                    </span>
                  </div>
                  <span className={styles.matchScore}>
                    {m.ourScore}:{m.opponentScore}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${styles.quickTileCol} ${styles.span3}`}>
          <button type="button" className={styles.quickTile} onClick={onCreateTraining}>
            <span className={styles.quickTileIcon}>
              <Icon name="dumbbell" size={18} />
            </span>
            <span className={styles.quickTileLabel}>Тренировка</span>
          </button>
          <button type="button" className={styles.quickTile} onClick={() => onOpenTeam(selectedTeam.id)}>
            <span className={styles.quickTileIcon}>
              <Icon name="clipboard" size={18} />
            </span>
            <span className={styles.quickTileLabel}>Задание</span>
          </button>
          <button type="button" className={styles.quickTile} onClick={() => onOpenTeam(selectedTeam.id)}>
            <span className={styles.quickTileIcon}>
              <Icon name="ball" size={18} />
            </span>
            <span className={styles.quickTileLabel}>Матч</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function dedupeByUser(list: PlayerActivity[]): PlayerActivity[] {
  const seen = new Set<string>();
  const out: PlayerActivity[] = [];
  for (const p of list) {
    if (seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push(p);
  }
  return out.sort((a, b) => (a.attendanceRate ?? 1) - (b.attendanceRate ?? 1));
}
