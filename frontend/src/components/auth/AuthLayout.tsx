import type { ReactNode } from "react";
import { Link } from "../Link";
import { Ornament } from "../shared/Ornament";
import { Icon, type IconName } from "../shared/Icon";
import styles from "./auth.module.css";

const POINTS: { icon: IconName; text: string }[] = [
  { icon: "users", text: "Тренеры рядом: смотрите профили и записывайтесь на занятия" },
  { icon: "calendar", text: "Один календарь тренировок, матчей и заданий" },
  { icon: "award", text: "Статистика и прогресс — видно, куда вы растёте" },
];

/** The shared frame of every sign-in / sign-up screen: a graphite brand panel
 * (collapsed to a slim bar on phones) next to the form card. */
export function AuthLayout({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <aside className={styles.brand}>
        <div className={styles.waves} aria-hidden="true">
          <Ornament tone="primary" intensity="bold" />
        </div>
        <div className={styles.brandInner}>
          <Link to="/" className={styles.brandHome} aria-label="SportArena Global — на главную">
            <span className={styles.brandMark} aria-hidden="true">
              SA
            </span>
            <span className={styles.brandName}>SportArena Global</span>
          </Link>

          <div className={styles.pitch}>
            <p className={styles.pitchTitle}>
              Тренируйся <em>с планом.</em>
              <br />
              Расти <em>с командой.</em>
            </p>
            <p className={styles.pitchLead}>
              Платформа для игроков и тренеров: расписание, записи на занятия, задания и статистика — в одном месте.
            </p>
            <ul className={styles.pitchList}>
              {POINTS.map((point) => (
                <li key={point.text} className={styles.pitchItem}>
                  <span className={styles.pitchIcon}>
                    <Icon name={point.icon} size={18} />
                  </span>
                  {point.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.card}>
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
