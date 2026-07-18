import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { getCalendar } from "../api/calendar";
import { ApiError } from "../api/client";
import { StateScreen } from "./StateScreen";
import { Icon } from "./shared/Icon";
import { CALENDAR_EVENT_ICONS, type CalendarEvent, type CalendarEventType } from "../types/calendar";
import styles from "./teams/teams.module.css";
import profileStyles from "./profile/profile.module.css";

type Mode = "list" | "overdue" | "day" | "week";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; events: CalendarEvent[] };

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDateLocal(iso: string): Date {
  const parts = iso.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day);
}

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

interface CalendarScreenProps {
  token: string;
  onOpenEvent?: (event: CalendarEvent) => void;
  onCreateTraining?: () => void;
}

export function CalendarScreen({ token, onOpenEvent, onCreateTraining }: CalendarScreenProps) {
  const [mode, setMode] = useState<Mode>("list");
  const [anchor, setAnchor] = useState(() => new Date());
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Independent of `mode` so the "Просрочено" badge count stays accurate
  // even while viewing День/Неделя, whose fetch only covers a narrow range.
  const [overdueCount, setOverdueCount] = useState(0);

  let dateFrom: string;
  let dateTo: string;
  if (mode === "day") {
    dateFrom = dateTo = toIso(anchor);
  } else if (mode === "week") {
    const start = startOfWeek(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    dateFrom = toIso(start);
    dateTo = toIso(end);
  } else {
    // Look back a couple of weeks too, not just forward — otherwise a
    // training that was never marked completed/cancelled quietly falls out
    // of view the moment its date passes, with no other screen left to find
    // it on (the standalone "Тренировки" tab was merged into this one).
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const end = new Date();
    end.setDate(end.getDate() + 60);
    dateFrom = toIso(start);
    dateTo = toIso(end);
  }

  const load = useCallback(() => {
    setState({ status: "loading" });
    getCalendar(token, dateFrom, dateTo)
      .then((events) => setState({ status: "ready", events }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить календарь";
        setState({ status: "error", message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, dateFrom, dateTo]);

  useEffect(load, [load]);

  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const end = new Date();
    end.setDate(end.getDate() + 60);
    getCalendar(token, toIso(start), toIso(end))
      .then((events) => setOverdueCount(events.filter((event) => isEventOverdue(event, toIso(new Date()))).length))
      .catch(() => {
        // Best-effort — the badge just omits a count on failure, the
        // "Просрочено" tab itself still refetches when opened.
      });
  }, [token]);

  const shift = (days: number) => {
    setAnchor((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + days);
      return next;
    });
  };

  const weekStart = startOfWeek(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const todayIso = toIso(new Date());
  let visibleEvents: CalendarEvent[] = [];
  if (state.status === "ready") {
    const overdue = state.events.filter((event) => isEventOverdue(event, todayIso));
    if (mode === "overdue") {
      visibleEvents = [...overdue].sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)));
    } else if (mode === "list") {
      visibleEvents = state.events.filter((event) => !isEventOverdue(event, todayIso)).sort((a, b) => compareUpcomingFirst(a, b, todayIso));
    } else {
      visibleEvents = state.events;
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Календарь</h1>
        {onCreateTraining && (
          <button type="button" className={styles.iconButton} onClick={onCreateTraining}>
            + Добавить тренировку
          </button>
        )}
      </div>

      <div className={styles.tabs}>
        <button type="button" className={mode === "list" ? styles.tabActive : styles.tab} onClick={() => setMode("list")}>
          Список
        </button>
        <button type="button" className={mode === "overdue" ? styles.tabActive : styles.tab} onClick={() => setMode("overdue")}>
          Просрочено{overdueCount > 0 ? ` · ${overdueCount}` : ""}
        </button>
        <button
          type="button"
          className={mode === "day" ? styles.tabActive : styles.tab}
          onClick={() => {
            setMode("day");
            setAnchor(new Date());
          }}
        >
          День
        </button>
        <button
          type="button"
          className={mode === "week" ? styles.tabActive : styles.tab}
          onClick={() => {
            setMode("week");
            setAnchor(new Date());
          }}
        >
          Неделя
        </button>
      </div>

      {(mode === "day" || mode === "week") && (
        <div className={styles.headerRow}>
          <button type="button" className={styles.iconButton} onClick={() => shift(mode === "day" ? -1 : -7)}>
            <Icon name="chevron-left" size={16} />
            Назад
          </button>
          <span className={profileStyles.subtitle} style={{ margin: 0 }}>
            {mode === "day"
              ? anchor.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
              : `${weekStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })} — ${weekEnd.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}`}
          </span>
          <button type="button" className={styles.iconButton} onClick={() => shift(mode === "day" ? 1 : 7)}>
            Вперёд
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      )}

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка календаря…" />}
      {state.status === "error" && (
        <StateScreen kind="error" title="Не удалось загрузить календарь" description={state.message} onRetry={load} />
      )}

      {state.status === "ready" && visibleEvents.length === 0 && (
        <StateScreen
          kind="empty"
          title={mode === "overdue" ? "Просроченных нет" : "Пока ничего нет"}
          description={
            mode === "overdue"
              ? "Все тренировки идут по плану."
              : "Здесь появятся тренировки, матчи и дедлайны заданий."
          }
        />
      )}

      {state.status === "ready" && visibleEvents.length > 0 && <EventList events={visibleEvents} onOpenEvent={onOpenEvent} />}
    </div>
  );
}

function compareUpcomingFirst(a: CalendarEvent, b: CalendarEvent, todayIso: string): number {
  const aFuture = a.date >= todayIso;
  const bFuture = b.date >= todayIso;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  if (aFuture) {
    return a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date);
  }
  return a.date === b.date ? (b.time ?? "").localeCompare(a.time ?? "") : b.date.localeCompare(a.date);
}

const EVENT_COLORS: Record<CalendarEventType, string> = {
  training: "var(--color-primary)",
  match: "var(--color-accent-blue)",
  task_deadline: "var(--color-warning)",
};

function isEventOverdue(event: CalendarEvent, todayIso: string): boolean {
  return event.type === "training" && event.status === "scheduled" && event.date < todayIso;
}

function EventList({ events, onOpenEvent }: { events: CalendarEvent[]; onOpenEvent?: (event: CalendarEvent) => void }) {
  const todayIso = toIso(new Date());
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = groups.get(event.date) ?? [];
    list.push(event);
    groups.set(event.date, list);
  }

  return (
    <>
      {Array.from(groups.entries()).map(([date, dayEvents]) => (
        <div key={date} className={profileStyles.card}>
          <h2 className={profileStyles.title}>
            {parseIsoDateLocal(date).toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "long" })}
          </h2>
          {dayEvents.map((event) => {
            const rowStyle = { "--event-color": EVENT_COLORS[event.type] } as CSSProperties;
            const rowContent = (
              <>
                <span className={styles.eventIcon}>
                  <Icon name={CALENDAR_EVENT_ICONS[event.type]} size={14} />
                  {event.time ? event.time.slice(0, 5) : ""}
                </span>
                <span className={profileStyles.rowValue}>
                  {event.title}
                  {event.teamName ? ` · ${event.teamName}` : ""}
                  {isEventOverdue(event, todayIso) && (
                    <span className={`${styles.badge} ${styles.badgeWarning}`} style={{ marginLeft: 6 }}>
                      Просрочена
                    </span>
                  )}
                </span>
              </>
            );
            if (!onOpenEvent) {
              return (
                <div key={`${event.type}-${event.id}`} className={styles.eventRow} style={rowStyle}>
                  {rowContent}
                </div>
              );
            }
            return (
              <button
                key={`${event.type}-${event.id}`}
                type="button"
                className={styles.eventRow}
                style={rowStyle}
                onClick={() => onOpenEvent(event)}
              >
                {rowContent}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
