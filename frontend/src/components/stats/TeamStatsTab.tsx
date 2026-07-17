import { useCallback, useEffect, useState } from "react";
import { getTeamStats } from "../../api/stats";
import { getAttendanceAnalysis, getReportAnalysis, getTeamSummary } from "../../api/ai";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { TeamStats } from "../../types/stats";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: TeamStats };

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function AiActionCard({
  title,
  description,
  buttonLabel,
  onRun,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onRun: () => Promise<string>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      setResult(await onRun());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось получить ответ ИИ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>{title}</h2>
      <p className={profileStyles.subtitle}>{description}</p>
      <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleClick()} disabled={loading}>
        {loading ? "Формирую…" : buttonLabel}
      </button>
      {error && <p className={profileStyles.error}>{error}</p>}
      {result && <p className={profileStyles.subtitle}>{result}</p>}
    </div>
  );
}

export function TeamStatsTab({ token, teamId }: { token: string; teamId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    getTeamStats(token, teamId)
      .then((stats) => setState({ status: "ready", stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить статистику";
        setState({ status: "error", message });
      });
  }, [token, teamId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка статистики…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить статистику" description={state.message} onRetry={load} />;
  }

  const { stats } = state;

  return (
    <>
      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Общее</h2>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Игроков в составе</span>
          <span className={profileStyles.rowValue}>{stats.membersCount}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Посещаемость</span>
          <span className={profileStyles.rowValue}>{formatRate(stats.attendanceRate)}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Проведено тренировок</span>
          <span className={profileStyles.rowValue}>{stats.trainingsCompleted}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Из них самостоятельных</span>
          <span className={profileStyles.rowValue}>{stats.independentTrainings}</span>
        </div>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Задания</h2>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Выполнено</span>
          <span className={profileStyles.rowValue}>
            {stats.tasksCompleted} / {stats.tasksTotal}
          </span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Просрочено</span>
          <span className={profileStyles.rowValue}>{stats.tasksOverdue}</span>
        </div>
        {stats.avgDifficulty !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Средняя сложность</span>
            <span className={profileStyles.rowValue}>{stats.avgDifficulty} / 10</span>
          </div>
        )}
        {stats.avgWellbeing !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Среднее самочувствие</span>
            <span className={profileStyles.rowValue}>{stats.avgWellbeing} / 5</span>
          </div>
        )}
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Матчи</h2>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Сыграно</span>
          <span className={profileStyles.rowValue}>{stats.matchesPlayed}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Победы / Ничьи / Поражения</span>
          <span className={profileStyles.rowValue}>
            {stats.matchesWon} / {stats.matchesDrawn} / {stats.matchesLost}
          </span>
        </div>
      </div>

      {stats.lowActivityPlayers.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Низкая активность</h2>
          {stats.lowActivityPlayers.map((p) => (
            <div key={p.userId} className={styles.memberRow}>
              <div className={styles.memberInfo}>
                <span className={styles.memberName}>
                  {p.firstName} {p.lastName ?? ""}
                </span>
                <span className={styles.memberMeta}>Посещаемость: {formatRate(p.attendanceRate)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats.frequentAbsencePlayers.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Частые пропуски</h2>
          {stats.frequentAbsencePlayers.map((p) => (
            <div key={p.userId} className={styles.memberRow}>
              <div className={styles.memberInfo}>
                <span className={styles.memberName}>
                  {p.firstName} {p.lastName ?? ""}
                </span>
                <span className={styles.memberMeta}>Пропусков: {p.absentCount}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AiActionCard
        title="Сводка по команде (ИИ)"
        description="Краткая сводка и предупреждение о возможной перегрузке игроков, если она есть."
        buttonLabel="Сформировать сводку"
        onRun={() => getTeamSummary(token, teamId)}
      />
      <AiActionCard
        title="Анализ посещаемости (ИИ)"
        description="ИИ разберёт посещаемость игроков и подскажет, на что обратить внимание."
        buttonLabel="Проанализировать посещаемость"
        onRun={() => getAttendanceAnalysis(token, teamId)}
      />
      <AiActionCard
        title="Анализ отчётов (ИИ)"
        description="ИИ разберёт последние отчёты о самостоятельных тренировках."
        buttonLabel="Проанализировать отчёты"
        onRun={() => getReportAnalysis(token, teamId)}
      />
    </>
  );
}
