import { getAdminOverview } from "../../api/admin";
import { ErrorBox, PageHead, formatNumber, useAdminQuery } from "./adminUi";
import styles from "./admin.module.css";

export function DashboardPage() {
  const { query, reload } = useAdminQuery(getAdminOverview, []);

  return (
    <>
      <PageHead title="Обзор" hint="Показатели считаются по данным платформы в реальном времени." />
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "ready" && (
        <div className={styles.grid}>
          <Kpi label="Пользователей" value={query.data.totalUsers} accent />
          <Kpi label="Заблокировано" value={query.data.bannedUsers} />
          <Kpi label="Команд" value={query.data.totalTeams} />
          <Kpi label="Тренировок" value={query.data.totalTrainings} />
          <Kpi label="Матчей" value={query.data.totalMatches} />
          <Kpi label="Заданий" value={query.data.totalTasks} />
        </div>
      )}
    </>
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
