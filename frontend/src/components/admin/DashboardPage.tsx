import { getAdminDashboard } from "../../api/admin";
import { BarChart, LineChart } from "./charts";
import { ErrorBox, PageHead, formatDate, formatNumber, useAdminQuery } from "./adminUi";
import styles from "./admin.module.css";

export function DashboardPage() {
  const { query, reload } = useAdminQuery(getAdminDashboard, []);

  return (
    <>
      <PageHead
        title="Обзор"
        hint="Все показатели считаются по данным платформы в реальном времени. Дни и недели — по UTC."
      />
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "ready" && <Dashboard d={query.data} />}
    </>
  );
}

function Dashboard({ d }: { d: Awaited<ReturnType<typeof getAdminDashboard>> }) {
  return (
    <>
      <h2 className={styles.sectionLabel} style={{ marginTop: 0 }}>Пользователи</h2>
      <div className={styles.grid}>
        <Kpi label="Всего пользователей" value={d.users.total} accent />
        <Kpi label="Новые сегодня" value={d.users.newToday} />
        <Kpi label="Новые за 7 дней" value={d.users.new7d} />
        <Kpi label="Новые за 30 дней" value={d.users.new30d} />
        <Kpi label="Игроки" value={d.users.players} note="есть профиль игрока" />
        <Kpi label="Тренеры" value={d.users.coaches} note="есть профиль тренера" />
        <Kpi label="Заблокировано" value={d.users.banned} />
      </div>

      <h2 className={styles.sectionLabel}>Активность</h2>
      <div className={styles.grid}>
        <Kpi label="DAU — за день" value={d.activity.dau} accent />
        <Kpi label="WAU — за 7 дней" value={d.activity.wau} />
        <Kpi label="MAU — за 30 дней" value={d.activity.mau} />
      </div>
      <p className={styles.pageHint} style={{ marginTop: -8, marginBottom: 18 }}>
        {d.activity.trackingSince
          ? `Считаются вошедшие пользователи, которые открывали сайт или пользовались им. Учёт ведётся с ${formatDate(d.activity.trackingSince)}.`
          : "Учёт активности только начался: данные появятся, когда пользователи откроют сайт."}
      </p>

      <h2 className={styles.sectionLabel}>Тренировки и записи</h2>
      <div className={styles.grid}>
        <Kpi label="Всего тренировок" value={d.trainings.total} accent />
        <Kpi label="Активные" value={d.trainings.active} note="запланированы" />
        <Kpi label="Предстоящие" value={d.trainings.upcoming} note="с сегодняшнего дня" />
        <Kpi label="Проведены" value={d.trainings.completed} />
        <Kpi label="Записи к тренерам" value={d.bookings.total} />
        <Kpi label="Подтверждённые записи" value={d.bookings.confirmed} />
        <Kpi label="Предстоящие записи" value={d.bookings.upcoming} />
      </div>

      <h2 className={styles.sectionLabel}>Динамика за 30 дней</h2>
      <div className={styles.charts}>
        <ChartCard title="Регистрации" total={sum(d.registrations)}>
          <BarChart data={d.registrations} label="Регистрации по дням" />
        </ChartCard>
        <ChartCard title="Активные пользователи по дням" total={null}>
          <LineChart data={d.activeUsers} label="Активные пользователи по дням" />
        </ChartCard>
        <ChartCard title="Созданные тренировки" total={sum(d.trainingsCreated)}>
          <BarChart data={d.trainingsCreated} label="Созданные тренировки по дням" />
        </ChartCard>
        <ChartCard title="Записи к тренерам" total={sum(d.bookingsCreated)}>
          <BarChart data={d.bookingsCreated} label="Записи по дням" />
        </ChartCard>
      </div>
    </>
  );
}

function sum(points: { count: number }[]): number {
  return points.reduce((total, p) => total + p.count, 0);
}

function ChartCard({ title, total, children }: { title: string; total: number | null; children: React.ReactNode }) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>
        {title}
        {total !== null && <span className={styles.muted} style={{ fontSize: 13, fontWeight: 600, marginLeft: 8 }}>{formatNumber(total)} за период</span>}
      </h3>
      {children}
    </section>
  );
}

export function Kpi({ label, value, note, accent }: { label: string; value: number; note?: string; accent?: boolean }) {
  return (
    <div className={accent ? styles.kpiAccent : styles.kpi}>
      <span className={styles.kpiValue}>{formatNumber(value)}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {note && <span className={styles.kpiNote}>{note}</span>}
    </div>
  );
}
