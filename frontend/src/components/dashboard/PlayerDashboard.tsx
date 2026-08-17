import { useCallback, useEffect, useState } from "react";
import { getCalendar } from "../../api/calendar";
import { getPlayerStats } from "../../api/stats";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import { formatRate, type PlayerStats } from "../../types/stats";
import styles from "./dashboard.module.css";

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([getCalendar(token, isoDatePlusDays(0), isoDatePlusDays(14)), getPlayerStats(token, userId)])
      .then(([events, stats]) => setState({ status: "ready", events, stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить данные";
        setState({ status: "error", message });
      });
  }, [token, userId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить главную" description={state.message} onRetry={load} />;
  }

  const { events, stats } = state;
  const today = isoDatePlusDays(0);
  const nextEvent = events.find((e) => e.date >= today);

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Твой прогресс</h1>
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

      <div className={styles.kpiRow}>
        <StatTile value={formatRate(stats.attendanceRate)} label="Посещаемость" tone="dark" />
        <StatTile value={stats.activityStreak} label="Серия посещений" />
        <StatTile value={stats.tasksCompleted} label="Заданий выполнено" />
        <StatTile value={stats.tasksOverdue} label="Просрочено" />
      </div>

      <button type="button" className={styles.recommendationCard} onClick={onOpenMyStats}>
        <Icon name="sparkles" size={20} />
        <div className={styles.nextEventText}>
          <span className={styles.nextEventTitle}>Рекомендации ИИ</span>
          <span className={styles.nextEventMeta}>Разбор прогресса и советы по нагрузке</span>
        </div>
        <Icon name="chevron-right" size={18} />
      </button>

      <button type="button" className={styles.quickAction} onClick={onCreateTraining}>
        <Icon name="plus" size={16} />
        Добавить тренировку
      </button>
    </div>
  );
}
