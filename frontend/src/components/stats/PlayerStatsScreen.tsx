import { useCallback, useEffect, useState } from "react";
import { getPlayerStats } from "../../api/stats";
import { deleteMetric } from "../../api/metrics";
import { getProgressAnalysis } from "../../api/ai";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { MetricForm } from "./MetricForm";
import { MATCH_RESULT_LABELS } from "../../types/match";
import type { Metric } from "../../types/metric";
import type { PlayerStats } from "../../types/stats";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: PlayerStats };

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function matchResultLabel(match: PlayerStats["matchesHistory"][number]): string {
  if (match.ourScore === null || match.opponentScore === null) return "";
  if (match.ourScore > match.opponentScore) return MATCH_RESULT_LABELS.win;
  if (match.ourScore < match.opponentScore) return MATCH_RESULT_LABELS.loss;
  return MATCH_RESULT_LABELS.draw;
}

export function PlayerStatsScreen({ token, userId, onBack }: { token: string; userId: string; onBack: () => void }) {
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [addingMetric, setAddingMetric] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const [deletingMetric, setDeletingMetric] = useState<Metric | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleAiAnalyze = async () => {
    setAiError(null);
    setAiRecommendation(null);
    setAiLoading(true);
    try {
      const text = await getProgressAnalysis(token);
      setAiRecommendation(text);
    } catch (err) {
      if (err instanceof ApiError && err.code === "player_profile_required") {
        setAiError("Рекомендации ИИ доступны только с заполненным профилем игрока.");
      } else {
        setAiError(err instanceof ApiError ? err.message : "Не удалось получить рекомендации ИИ");
      }
    } finally {
      setAiLoading(false);
    }
  };

  const load = useCallback(() => {
    setState({ status: "loading" });
    getPlayerStats(token, userId)
      .then((stats) => setState({ status: "ready", stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить статистику";
        setState({ status: "error", message });
      });
  }, [token, userId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка статистики…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить статистику" description={state.message} onRetry={load} />;
  }

  const { stats } = state;

  const handleDeleteMetric = async () => {
    if (!deletingMetric) return;
    setBusy(true);
    try {
      await deleteMetric(token, deletingMetric.id);
      setDeletingMetric(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить показатель");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          ← Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.title}>Статистика</h1>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Тренировок посещено</span>
          <span className={profileStyles.rowValue}>
            {stats.trainingsAttended} / {stats.teamTrainingsCount}
          </span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Посещаемость</span>
          <span className={profileStyles.rowValue}>{formatRate(stats.attendanceRate)}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Серия посещений подряд</span>
          <span className={profileStyles.rowValue}>{stats.activityStreak}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Личных тренировок</span>
          <span className={profileStyles.rowValue}>{stats.personalTrainingsCount}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Тренировочное время</span>
          <span className={profileStyles.rowValue}>{Math.round(stats.trainingMinutes / 60)} ч</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Задания выполнено</span>
          <span className={profileStyles.rowValue}>
            {stats.tasksCompleted} / {stats.tasksTotal}
          </span>
        </div>
        {stats.tasksOverdue > 0 && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Просрочено заданий</span>
            <span className={profileStyles.rowValue}>{stats.tasksOverdue}</span>
          </div>
        )}
      </div>

      {userId === myUserId && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Рекомендации ИИ</h2>
          <p className={profileStyles.subtitle}>ИИ проанализирует ваш прогресс по тренировкам, заданиям и показателям.</p>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleAiAnalyze()} disabled={aiLoading}>
            {aiLoading ? "Анализирую…" : "Получить рекомендации"}
          </button>
          {aiError && <p className={profileStyles.error}>{aiError}</p>}
          {aiRecommendation && <p className={profileStyles.subtitle}>{aiRecommendation}</p>}
        </div>
      )}

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {stats.personalRecords.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Личные рекорды</h2>
          {stats.personalRecords.map((r) => (
            <div key={r.name} className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>{r.name}</span>
              <span className={profileStyles.rowValue}>
                {r.value} {r.unit ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={profileStyles.card}>
        <div className={styles.teamCardTop}>
          <span className={profileStyles.title}>Показатели</span>
          {!addingMetric && (
            <button type="button" className={styles.iconButton} onClick={() => setAddingMetric(true)}>
              + Добавить
            </button>
          )}
        </div>

        {addingMetric && (
          <MetricForm
            token={token}
            userId={userId}
            onSaved={() => {
              setAddingMetric(false);
              load();
            }}
            onCancel={() => setAddingMetric(false)}
          />
        )}

        {editingMetric && (
          <MetricForm
            token={token}
            userId={userId}
            initial={editingMetric}
            onSaved={() => {
              setEditingMetric(null);
              load();
            }}
            onCancel={() => setEditingMetric(null)}
          />
        )}

        {stats.metrics.length === 0 && !addingMetric && <p className={profileStyles.subtitle}>Пока нет записей.</p>}

        {!addingMetric &&
          !editingMetric &&
          stats.metrics.map((metric) => (
            <div key={metric.id} className={profileStyles.row}>
              <div>
                <div className={profileStyles.rowValue}>
                  {metric.name}: {metric.value} {metric.unit ?? ""}
                </div>
                <div className={styles.memberMeta}>
                  {metric.recordedDate}
                  {metric.source ? ` · ${metric.source}` : ""}
                </div>
              </div>
              {metric.recordedBy === myUserId && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className={styles.iconButton} onClick={() => setEditingMetric(metric)}>
                    Изменить
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => setDeletingMetric(metric)}>
                    Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>

      {stats.matchesHistory.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>История матчей</h2>
          {stats.matchesHistory.map((m) => (
            <div key={m.id} className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>
                {m.matchDate} · {m.teamName ?? ""}
              </span>
              <span className={profileStyles.rowValue}>
                {m.opponentName}: {m.ourScore}:{m.opponentScore} ({matchResultLabel(m)})
              </span>
            </div>
          ))}
        </div>
      )}

      {stats.coachComments.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Комментарии тренера</h2>
          {stats.coachComments.map((c, index) => (
            <div key={index} className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>{c.context}</span>
              <span className={profileStyles.rowValue}>{c.comment}</span>
            </div>
          ))}
        </div>
      )}

      {deletingMetric && (
        <ConfirmModal
          title="Удалить показатель?"
          danger
          busy={busy}
          confirmLabel="Удалить"
          onConfirm={handleDeleteMetric}
          onCancel={() => setDeletingMetric(null)}
        />
      )}
    </div>
  );
}
