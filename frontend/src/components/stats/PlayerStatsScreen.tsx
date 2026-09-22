import { useCallback, useEffect, useState } from "react";
import { getPlayerStats } from "../../api/stats";
import { deleteMetric } from "../../api/metrics";
import { getProgressAnalysis } from "../../api/ai";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Icon } from "../shared/Icon";
import { StatTile } from "../shared/StatTile";
import { MetricForm } from "./MetricForm";
import { MATCH_RESULT_LABELS } from "../../types/match";
import type { Metric } from "../../types/metric";
import { formatRate, type PlayerStats } from "../../types/stats";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import dashStyles from "../dashboard/dashboard.module.css";
import statsStyles from "./stats.module.css";

const RING_RADIUS = 68;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; stats: PlayerStats };

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
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <h1 className={profileStyles.pageHeading}>Статистика</h1>

      <div className={dashStyles.bento}>
        <div className={`${statsStyles.ringCard} ${dashStyles.span5}`}>
          <div className={statsStyles.ringWrap}>
            <svg width="150" height="150" viewBox="0 0 150 150" className={statsStyles.ringSvg}>
              <circle cx="75" cy="75" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="14" />
              <circle
                cx="75"
                cy="75"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - (stats.attendanceRate ?? 0))}
              />
            </svg>
            <span className={statsStyles.ringValue}>{formatRate(stats.attendanceRate)}</span>
          </div>
          <div className={statsStyles.ringText}>
            <span className={statsStyles.ringLabel}>Посещаемость</span>
            <span className={statsStyles.ringSubtitle}>
              {stats.trainingsAttended} из {stats.teamTrainingsCount}
              <br />
              тренировок
            </span>
          </div>
        </div>

        <div className={`${dashStyles.kpiRow} ${dashStyles.span7}`}>
          <StatTile value={stats.activityStreak} label="Серия подряд" />
          <StatTile value={`${stats.tasksCompleted}/${stats.tasksTotal}`} label="Заданий выполнено" />
          <StatTile value={`${Math.round(stats.trainingMinutes / 60)} ч`} label="Тренировочное время" />
          <StatTile value={stats.personalTrainingsCount} label="Личных тренировок" />
        </div>

        {userId === myUserId && (
          <div className={`${statsStyles.aiCard} ${dashStyles.span4}`}>
            <div className={statsStyles.aiCardHead}>
              <Icon name="sparkles" size={18} />
              <span className={statsStyles.aiCardTitle}>Рекомендации ИИ</span>
            </div>
            {!aiRecommendation && (
              <p className={profileStyles.subtitle}>ИИ проанализирует прогресс по тренировкам, заданиям и показателям.</p>
            )}
            {aiRecommendation && <p className={profileStyles.subtitle}>{aiRecommendation}</p>}
            {aiError && <p className={profileStyles.error}>{aiError}</p>}
            <button
              type="button"
              className={profileStyles.buttonPrimary}
              onClick={() => void handleAiAnalyze()}
              disabled={aiLoading}
              style={{ marginTop: "auto" }}
            >
              {aiLoading ? "Анализирую…" : aiRecommendation ? "Обновить разбор" : "Получить рекомендации"}
            </button>
          </div>
        )}

        {stats.personalRecords.length > 0 && (
          <div className={`${dashStyles.card} ${dashStyles.span4}`}>
            <div className={dashStyles.cardHeader}>
              <h3 className={dashStyles.cardTitle}>Личные рекорды</h3>
            </div>
            <div className={dashStyles.rowList}>
              {stats.personalRecords.map((r) => (
                <div key={r.name} className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>{r.name}</span>
                  <span className={profileStyles.rowValue}>
                    {r.value} {r.unit ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.coachComments.length > 0 && (
          <div className={`${dashStyles.card} ${dashStyles.span4}`}>
            <div className={dashStyles.cardHeader}>
              <h3 className={dashStyles.cardTitle}>Комментарии тренера</h3>
            </div>
            <div className={dashStyles.rowList}>
              {stats.coachComments.map((c, index) => (
                <div key={index} className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>{c.context}</span>
                  <span className={profileStyles.rowValue}>{c.comment}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {actionError && (
          <div className={`${dashStyles.card} ${dashStyles.span12}`}>
            <p className={profileStyles.error}>{actionError}</p>
          </div>
        )}

        <div className={`${dashStyles.card} ${dashStyles.span8}`}>
          <div className={dashStyles.cardHeader}>
            <h3 className={dashStyles.cardTitle}>Показатели</h3>
            {!addingMetric && (
              <button type="button" className={dashStyles.cardAction} onClick={() => setAddingMetric(true)}>
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

          {!addingMetric && !editingMetric && (
            <div className={dashStyles.rowList}>
              {stats.metrics.map((metric) => (
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
          )}
        </div>

        {stats.matchesHistory.length > 0 && (
          <div className={`${dashStyles.card} ${dashStyles.span4}`}>
            <div className={dashStyles.cardHeader}>
              <h3 className={dashStyles.cardTitle}>История матчей</h3>
            </div>
            <div className={dashStyles.rowList}>
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
          </div>
        )}
      </div>

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
