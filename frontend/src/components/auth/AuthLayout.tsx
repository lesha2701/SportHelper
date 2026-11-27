import type { ReactNode } from "react";
import { Link } from "../Link";
import { BrandLogo } from "../shared/BrandLogo";
import { SiteFooter } from "../shared/SiteFooter";
import { Icon, type IconName } from "../shared/Icon";
import styles from "./auth.module.css";

const POINTS: { icon: IconName; text: string }[] = [
  { icon: "users", text: "Тренеры рядом: смотрите профили и записывайтесь на занятия" },
  { icon: "calendar", text: "Все ваши тренировки и занятия в одном календаре" },
  { icon: "award", text: "Статистика и прогресс — видно, куда вы растёте" },
];

/** The shared frame of every sign-in / sign-up screen: a plain brand panel
 * (collapsed to a slim bar on phones) next to the form card. */
export function AuthLayout({ title, lead, wide, children }: { title: string; lead?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <aside className={styles.brand}>
        <div className={styles.brandInner}>
          <Link to="/" className={styles.brandHome} aria-label="SportArenaGlobal — на главную">
            <BrandLogo className={styles.brandMark} />
            <span className={styles.brandName}>SportArenaGlobal</span>
          </Link>

          <div className={styles.pitch}>
            <p className={styles.pitchTitle}>
              Тренируйся <em>с планом.</em>
              <br />
              Расти <em>с тренером.</em>
            </p>
            <p className={styles.pitchLead}>
              Платформа для игроков и тренеров: расписание, записи на занятия и статистика — в одном месте.
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
        <div className={wide ? `${styles.card} ${styles.cardWide}` : styles.card}>
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
          {children}
        </div>
      </main>
      <div className={styles.footerSlot}>
        <SiteFooter />
      </div>
    </div>
  );
}
