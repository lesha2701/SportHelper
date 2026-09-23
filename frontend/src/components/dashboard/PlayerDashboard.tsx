import { useCallback, useEffect, useState } from "react";
import { getCalendar } from "../../api/calendar";
import { getPlayerStats } from "../../api/stats";
import { getProgressAnalysis } from "../../api/ai";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import { MATCH_RESULT_LABELS } from "../../types/match";
import { formatRate, type PlayerStats } from "../../types/stats";
import styles from "./dashboard.module.css";
import aiStyles from "../stats/stats.module.css";

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

function matchResultLabel(match: PlayerStats["matchesHistory"][number]): string {
  if (match.ourScore === null || match.opponentScore === null) return "";
  if (match.ourScore > match.opponentScore) return MATCH_RESULT_LABELS.win;
  if (match.ourScore < match.opponentScore) return MATCH_RESULT_LABELS.loss;
  return MATCH_RESULT_LABELS.draw;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; events: CalendarEvent[]; stats: PlayerStats };

export function PlayerDashboard({
  token,
  userId,
  onOpenEvent,
  onCreateTraining,
  onOpenMyStats,
}: {
  token: string;
  userId: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreateTraining: () => void;
  onOpenMyStats: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    const weekStart = toIso(startOfWeek(new Date()));
    Promise.all([getCalendar(token, weekStart, isoDatePlusDays(13)), getPlayerStats(token, userId)])
      .then(([events, stats]) => setState({ status: "ready", events, stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить данные";
        setState({ status: "error", message });
      });
  }, [token, userId]);

  useEffect(load, [load]);

  const handleAiAnalyze = async () => {
    setAiError(null);
    setAiLoading(true);
    try {
      setAiRecommendation(await getProgressAnalysis(token));
    } catch (err) {
      setAiError(
        err instanceof ApiError && err.code === "player_profile_required"
          ? "Рекомендации ИИ доступны только с заполненным профилем игрока."
          : err instanceof ApiError
            ? err.message
            : "Не удалось получить рекомендации ИИ",
      );
    } finally {
      setAiLoading(false);
    }
  };

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить главную" description={state.message} onRetry={load} />;
  }

  const { events, stats } = state;
  const today = isoDatePlusDays(0);
  const nextEvent = events.find((e) => e.date >= today);

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

  const recentMatches = stats.matchesHistory.slice(0, 3);

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Твой прогресс</h1>
      </div>

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
                <p className={styles.heroSubtitle}>Запланируйте тренировку</p>
              </div>
            </div>
          )}
        </button>

        <div className={`${styles.kpiRow} ${styles.span5}`}>
          <StatTile value={formatRate(stats.attendanceRate)} label="Посещаемость" tone="dark" />
          <StatTile value={stats.activityStreak} label="Серия посещений" />
          <StatTile value={stats.tasksCompleted} label="Заданий выполнено" />
          <StatTile value={stats.tasksOverdue} label="Просрочено" />
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

        <div className={`${aiStyles.aiCard} ${styles.span4}`}>
          <div className={aiStyles.aiCardHead}>
            <Icon name="sparkles" size={18} />
            <span className={aiStyles.aiCardTitle}>Рекомендации ИИ</span>
          </div>
          {!aiRecommendation && <p className={styles.emptyHint} style={{ padding: 0 }}>Разбор прогресса и советы по нагрузке.</p>}
          {aiRecommendation && (
            <p className={styles.emptyHint} style={{ padding: 0 }}>
              {aiRecommendation}
            </p>
          )}
          {aiError && <p className={styles.emptyHint} style={{ padding: 0, color: "var(--color-danger)" }}>{aiError}</p>}
          <button
            type="button"
            className={styles.quickAction}
            onClick={() => void handleAiAnalyze()}
            disabled={aiLoading}
            style={{ marginTop: "auto" }}
          >
            {aiLoading ? "Анализирую…" : aiRecommendation ? "Обновить разбор" : "Получить рекомендации"}
          </button>
        </div>

        <div className={`${styles.card} ${styles.span8}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Последние матчи</h3>
          </div>
          {recentMatches.length === 0 ? (
            <p className={styles.emptyHint}>Пока нет сыгранных матчей.</p>
          ) : (
            <div className={styles.rowList}>
              {recentMatches.map((m) => (
                <div key={m.id} className={styles.matchRow}>
                  <div className={styles.matchText}>
                    <span className={styles.matchOpp}>{m.opponentName}</span>
                    <span className={styles.matchDate}>
                      {parseIsoDateLocal(m.matchDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                      {m.teamName ? ` · ${m.teamName}` : ""} · {matchResultLabel(m)}
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

        <div className={`${styles.quickTileCol} ${styles.span4}`}>
          <button type="button" className={styles.quickTile} onClick={onCreateTraining}>
            <span className={styles.quickTileIcon}>
              <Icon name="dumbbell" size={18} />
            </span>
            <span className={styles.quickTileLabel}>Тренировка</span>
          </button>
          <button type="button" className={styles.quickTile} onClick={onOpenMyStats}>
            <span className={styles.quickTileIcon}>
              <Icon name="award" size={18} />
            </span>
            <span className={styles.quickTileLabel}>Статистика</span>
          </button>
        </div>
      </div>
    </div>
  );
}
