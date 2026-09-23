import { useCallback, useEffect, useState } from "react";
import { getTeamStats } from "../../api/stats";
import { getAttendanceAnalysis, getReportAnalysis, getTeamSummary } from "../../api/ai";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { StatTile } from "../shared/StatTile";
import { formatRate, type TeamStats } from "../../types/stats";
import profileStyles from "../profile/profile.module.css";
import dashStyles from "../dashboard/dashboard.module.css";
import aiStyles from "./stats.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: TeamStats };

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
    <div className={`${aiStyles.aiCard} ${dashStyles.span4}`}>
      <div className={aiStyles.aiCardHead}>
        <Icon name="sparkles" size={18} />
        <span className={aiStyles.aiCardTitle}>{title}</span>
      </div>
      <p className={profileStyles.subtitle}>{description}</p>
      {error && <p className={profileStyles.error}>{error}</p>}
      {result && <p className={profileStyles.subtitle}>{result}</p>}
      <button
        type="button"
        className={profileStyles.buttonPrimary}
        onClick={() => void handleClick()}
        disabled={loading}
        style={{ marginTop: "auto" }}
      >
        {loading ? "Формирую…" : buttonLabel}
      </button>
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

  const attentionPlayers = dedupeByUser([...stats.frequentAbsencePlayers, ...stats.lowActivityPlayers]);

  return (
    <div className={dashStyles.bento}>
      <div className={`${dashStyles.kpiRow} ${dashStyles.span8}`}>
        <StatTile value={stats.membersCount} label="Игроков в составе" />
        <StatTile value={formatRate(stats.attendanceRate)} label="Посещаемость" tone="dark" />
        <StatTile value={stats.trainingsCompleted} label="Проведено тренировок" />
        <StatTile value={stats.independentTrainings} label="Из них самостоятельных" />
      </div>

      <div className={`${dashStyles.card} ${dashStyles.span4}`}>
        <div className={dashStyles.cardHeader}>
          <h3 className={dashStyles.cardTitle}>Задания</h3>
        </div>
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

      <div className={`${dashStyles.kpiRow} ${dashStyles.span8}`}>
        <StatTile value={stats.matchesPlayed} label="Сыграно" />
        <StatTile value={stats.matchesWon} label="Победы" />
        <StatTile value={stats.matchesDrawn} label="Ничьи" />
        <StatTile value={stats.matchesLost} label="Поражения" />
      </div>

      {attentionPlayers.length > 0 && (
        <div className={`${dashStyles.card} ${dashStyles.span4}`}>
          <div className={dashStyles.cardHeader}>
            <h3 className={dashStyles.cardTitle}>Требуют внимания</h3>
          </div>
          <div className={dashStyles.rowList}>
            {attentionPlayers.map((p) => (
              <div key={p.userId} className={dashStyles.attentionRow}>
                <div className={dashStyles.attentionAvatar}>{p.firstName.charAt(0).toUpperCase()}</div>
                <div className={dashStyles.attentionText}>
                  <span className={dashStyles.attentionName}>
                    {p.firstName} {p.lastName ?? ""}
                  </span>
                  <span className={dashStyles.attentionWhy}>{p.absentCount} пропусков</span>
                </div>
                <span className={dashStyles.attentionRate}>{formatRate(p.attendanceRate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AiActionCard
        title="Сводка по команде"
        description="Краткая сводка и предупреждение о возможной перегрузке игроков, если она есть."
        buttonLabel="Сформировать сводку"
        onRun={() => getTeamSummary(token, teamId)}
      />
      <AiActionCard
        title="Анализ посещаемости"
        description="ИИ разберёт посещаемость игроков и подскажет, на что обратить внимание."
        buttonLabel="Проанализировать посещаемость"
        onRun={() => getAttendanceAnalysis(token, teamId)}
      />
      <AiActionCard
        title="Анализ отчётов"
        description="ИИ разберёт последние отчёты о самостоятельных тренировках."
        buttonLabel="Проанализировать отчёты"
        onRun={() => getReportAnalysis(token, teamId)}
      />
    </div>
  );
}

function dedupeByUser<T extends { userId: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of list) {
    if (seen.has(p.userId)) continue;
    seen.add(p.userId);
    out.push(p);
  }
  return out;
}
