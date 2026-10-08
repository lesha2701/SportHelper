import { navigateApp } from "../../appNav";
import { useIsPhone } from "../../hooks/useIsPhone";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import { Icon } from "../shared/Icon";
import styles from "./dashboard.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_TODAY_ROWS = 3;

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const weekdayIndex = (d: Date) => (d.getDay() === 0 ? 6 : d.getDay() - 1);

function eventsLabel(count: number): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return `${count} событие`;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return `${count} события`;
  return `${count} событий`;
}

/** The "Эта неделя" card body. On a desktop-width screen: the 7-day grid. On a
 * phone that grid is squeezed into unreadable columns, so there it is just
 * today's brief plus a button into the calendar. */
export function WeekOverview({
  weekDays,
  events,
  today,
  onOpenEvent,
}: {
  weekDays: Date[];
  events: CalendarEvent[];
  today: string;
  onOpenEvent: (event: CalendarEvent) => void;
}) {
  const isPhone = useIsPhone();

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.date) ?? [];
    list.push(e);
    eventsByDay.set(e.date, list);
  }

  if (!isPhone) {
    return (
      <>
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
                  <span className={styles.weekColWd}>{WEEKDAY_LABELS[weekdayIndex(d)]}</span>
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
      </>
    );
  }

  const todays = eventsByDay.get(today) ?? [];
  const next = events.find((e) => e.date > today);
  const todayDate = new Date();
  const dateLabel = todayDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className={styles.todayBrief}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Сегодня</h3>
        <span className={styles.todayDate}>{dateLabel}</span>
      </div>

      {todays.length === 0 ? (
        <p className={styles.todayEmpty}>
          Сегодня событий нет.
          {next && (
            <>
              {" "}
              Ближайшее: {new Date(`${next.date}T00:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" })}
              {next.time ? `, ${next.time.slice(0, 5)}` : ""} — {next.title}.
            </>
          )}
        </p>
      ) : (
        <>
          <p className={styles.todayEmpty}>Сегодня вас ждёт: {eventsLabel(todays.length)}.</p>
          <div className={styles.todayList}>
            {todays.slice(0, MAX_TODAY_ROWS).map((e) => (
              <button key={e.id} type="button" className={styles.todayRow} onClick={() => onOpenEvent(e)}>
                <span className={styles.todayRowIcon}>
                  <Icon name={CALENDAR_EVENT_ICONS[e.type]} size={16} />
                </span>
                <span className={styles.todayRowTime}>{e.time ? e.time.slice(0, 5) : "весь день"}</span>
                <span className={styles.todayRowTitle}>{e.title}</span>
              </button>
            ))}
          </div>
          {todays.length > MAX_TODAY_ROWS && <p className={styles.todayEmpty}>и ещё {todays.length - MAX_TODAY_ROWS} — в календаре.</p>}
        </>
      )}

      <button type="button" className={styles.todayCalendarButton} onClick={() => navigateApp({ kind: "tab", tab: "calendar" })}>
        <Icon name="calendar" size={16} />
        Открыть календарь
      </button>
    </div>
  );
}
