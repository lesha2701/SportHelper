import { useCallback, useEffect, useState } from "react";
import { cancelTrainingSeries, getTraining, getTrainingFeedback, skipTrainingFeedback, submitTrainingFeedback, updateTraining } from "../../api/trainings";
import { getPlan } from "../../api/plans";
import { getTrainingEvaluation } from "../../api/ai";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { AttendanceScreen } from "./AttendanceScreen";
import { ReportScreen } from "./ReportScreen";
import { PLAN_SECTIONS, PLAN_SECTION_LABELS, type Plan } from "../../types/plan";
import { TRAINING_STATUS_LABELS, isTrainingOverdue, type Training, type TrainingFeedback, type TrainingStatus } from "../../types/training";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libraryStyles from "../library/library.module.css";
import confirmModalStyles from "../shared/ConfirmModal.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; training: Training };
type FeedbackLoadState = { status: "loading" } | { status: "ready"; feedback: TrainingFeedback | null } | { status: "error" };

export function TrainingDetail({
  token,
  trainingId,
  canEdit: canEditProp,
  onBack,
  onEdit,
}: {
  token: string;
  trainingId: string;
  /** Omit to let the component decide for itself (true for the viewer's own
   * personal trainings, false otherwise) — used when opening a training from
   * a context that doesn't already know the viewer's role in its team, e.g.
   * calendar click-through, where the same "training" event kind covers
   * team, independent, and personal trainings alike. Callers that DO know
   * the real role (TeamTrainingsTab, which already has canManage from the
   * team's own member list) should keep passing it explicitly. */
  canEdit?: boolean;
  onBack: () => void;
  onEdit: (training: Training) => void;
}) {
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [cancelChoiceOpen, setCancelChoiceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [feedbackState, setFeedbackState] = useState<FeedbackLoadState>({ status: "loading" });
  const [feedbackWellbeing, setFeedbackWellbeing] = useState<number | null>(null);
  const [feedbackDifficulty, setFeedbackDifficulty] = useState<number | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const [aiEvaluation, setAiEvaluation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleAiEvaluate = useCallback(async () => {
    setAiError(null);
    setAiEvaluation(null);
    setAiLoading(true);
    try {
      const text = await getTrainingEvaluation(token, trainingId);
      setAiEvaluation(text);
    } catch (err) {
      if (err instanceof ApiError && err.code === "player_profile_required") {
        setAiError("Оценка ИИ доступна только с заполненным профилем игрока.");
      } else {
        setAiError(err instanceof ApiError ? err.message : "Не удалось получить оценку ИИ");
      }
    } finally {
      setAiLoading(false);
    }
  }, [token, trainingId]);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getTraining(token, trainingId)
      .then((training) => setState({ status: "ready", training }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить тренировку";
        setState({ status: "error", message });
      });
  }, [token, trainingId]);

  useEffect(load, [load]);

  const loadFeedback = useCallback(() => {
    setFeedbackState({ status: "loading" });
    getTrainingFeedback(token, trainingId)
      .then((feedback) => setFeedbackState({ status: "ready", feedback }))
      .catch(() => setFeedbackState({ status: "error" }));
  }, [token, trainingId]);

  const trainingStatus = state.status === "ready" ? state.training.status : null;
  useEffect(() => {
    if (trainingStatus !== "completed") {
      setFeedbackState({ status: "ready", feedback: null });
      return;
    }
    loadFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingStatus, loadFeedback]);

  const trainingPlanId = state.status === "ready" ? state.training.planId : null;
  useEffect(() => {
    if (!trainingPlanId) {
      setPlan(null);
      return;
    }
    getPlan(token, trainingPlanId)
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [token, trainingPlanId]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка тренировки…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить тренировку" description={state.message} onRetry={load} />;
  }

  const { training } = state;
  const canEdit = canEditProp ?? training.type === "personal";

  const isResponsible = myUserId !== null && training.responsibleUserId === myUserId;
  const canMarkAttendance = canEdit || (training.type === "independent" && isResponsible);
  const overdue = isTrainingOverdue(training);

  if (showAttendance) {
    return <AttendanceScreen token={token} trainingId={training.id} canEdit={canMarkAttendance} onBack={() => setShowAttendance(false)} />;
  }

  if (showReport) {
    return <ReportScreen token={token} training={training} canReview={canEdit} onBack={() => setShowReport(false)} />;
  }

  const handleCancelSeries = async () => {
    setBusy(true);
    try {
      await cancelTrainingSeries(token, training.id);
      setCancelChoiceOpen(false);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось отменить серию");
    } finally {
      setBusy(false);
    }
  };

  const handleSetStatus = async (status: TrainingStatus) => {
    setBusy(true);
    setActionError(null);
    try {
      await updateTraining(token, training.id, {
        training_date: training.trainingDate,
        start_time: training.startTime,
        duration_minutes: training.durationMinutes,
        location: training.location,
        description: training.description,
        plan_id: training.planId,
        reminder_minutes_before: training.reminderMinutesBefore,
        status,
        is_independent: training.type === "independent",
        responsible_user_id: training.responsibleUserId,
      });
      setCancelChoiceOpen(false);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось изменить статус");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelClick = () => {
    if (training.recurrenceGroupId) {
      setCancelChoiceOpen(true);
    } else {
      void handleSetStatus("cancelled");
    }
  };

  const handleFeedbackSubmit = async () => {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      const feedback = await submitTrainingFeedback(token, training.id, {
        wellbeing: feedbackWellbeing,
        difficulty: feedbackDifficulty,
        comment: feedbackComment.trim() || null,
      });
      setFeedbackState({ status: "ready", feedback });
      await handleAiEvaluate();
    } catch (err) {
      setFeedbackError(err instanceof ApiError ? err.message : "Не удалось сохранить отзыв");
    } finally {
      setFeedbackBusy(false);
    }
  };

  const handleFeedbackSkip = async () => {
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      const feedback = await skipTrainingFeedback(token, training.id);
      setFeedbackState({ status: "ready", feedback });
    } catch (err) {
      setFeedbackError(err instanceof ApiError ? err.message : "Не удалось пропустить отзыв");
    } finally {
      setFeedbackBusy(false);
    }
  };

  const showFeedbackPrompt = training.status === "completed" && feedbackState.status === "ready" && feedbackState.feedback === null;
  const showAiSection = training.status === "completed" && feedbackState.status === "ready" && feedbackState.feedback !== null;
  const showFeedbackError = training.status === "completed" && feedbackState.status === "error";

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          ← Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <div className={styles.teamCardTop}>
          <h1 className={profileStyles.title}>
            {training.trainingDate} · {training.startTime.slice(0, 5)}
          </h1>
          <span className={styles.badge}>{TRAINING_STATUS_LABELS[training.status]}</span>
          {overdue && <span className={`${styles.badge} ${styles.badgeWarning}`}>Просрочена</span>}
          {canEdit && (
            <button type="button" className={styles.iconButton} title="Редактировать" aria-label="Редактировать" onClick={() => onEdit(training)}>
              ✏️
            </button>
          )}
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Длительность</span>
          <span className={profileStyles.rowValue}>{training.durationMinutes} мин</span>
        </div>
        {training.location && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Место</span>
            <span className={profileStyles.rowValue}>{training.location}</span>
          </div>
        )}
        {training.description && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Описание</span>
            <span className={profileStyles.rowValue}>{training.description}</span>
          </div>
        )}
        {training.reminderMinutesBefore !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Напоминание</span>
            <span className={profileStyles.rowValue}>за {training.reminderMinutesBefore} мин</span>
          </div>
        )}
        {training.recurrenceGroupId && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Повторяющаяся</span>
            <span className={profileStyles.rowValue}>да</span>
          </div>
        )}
      </div>

      {plan && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>План: {plan.name}</h2>
          {plan.description && <p className={profileStyles.subtitle}>{plan.description}</p>}
          {PLAN_SECTIONS.map((section) => {
            const items = plan.exercises.filter((e) => e.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <h3 className={libraryStyles.sectionTitle}>{PLAN_SECTION_LABELS[section]}</h3>
                {items.map((item) => (
                  <div key={item.id} className={libraryStyles.planExerciseRow}>
                    <div>
                      <div className={libraryStyles.planExerciseName}>{item.exerciseName ?? "Упражнение удалено"}</div>
                      <div className={libraryStyles.planExerciseMeta}>
                        {[
                          item.sets !== null ? `${item.sets} подх.` : null,
                          item.reps !== null ? `${item.reps} повт.` : null,
                          item.durationSeconds !== null ? `${item.durationSeconds} сек` : null,
                          item.restSeconds !== null ? `отдых ${item.restSeconds} сек` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {(training.type === "team" || training.type === "independent") && (
        <div className={profileStyles.card}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setShowAttendance(true)}>
            Посещаемость
          </button>
          {training.type === "independent" && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowReport(true)}>
              Отчёт
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <div className={profileStyles.card}>
          {training.status === "scheduled" ? (
            <>
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleSetStatus("completed")} disabled={busy}>
                Отметить проведённой
              </button>
              <button type="button" className={profileStyles.buttonSecondary} onClick={handleCancelClick} disabled={busy}>
                Отменить тренировку
              </button>
            </>
          ) : (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleSetStatus("scheduled")} disabled={busy}>
              Вернуть в расписание
            </button>
          )}
        </div>
      )}

      {showFeedbackError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>Не удалось загрузить отзыв о тренировке.</p>
          <button type="button" className={profileStyles.buttonSecondary} onClick={loadFeedback}>
            Повторить
          </button>
        </div>
      )}

      {showFeedbackPrompt && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Как прошла тренировка?</h2>
          <p className={profileStyles.subtitle}>Коротко расскажите, как всё прошло — это поможет ИИ дать конкретную оценку.</p>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Самочувствие (1 — плохо, 5 — отлично)</span>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={feedbackWellbeing === n ? profileStyles.buttonPrimary : profileStyles.buttonSecondary}
                  style={{ flex: 1, padding: "8px 0" }}
                  onClick={() => setFeedbackWellbeing(n)}
                  disabled={feedbackBusy}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Нагрузка (1 — легко, 10 — на пределе)</span>
            <input
              className={profileStyles.input}
              type="number"
              min={1}
              max={10}
              value={feedbackDifficulty ?? ""}
              onChange={(e) => setFeedbackDifficulty(e.target.value ? Number(e.target.value) : null)}
              disabled={feedbackBusy}
            />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Комментарий (необязательно)</span>
            <textarea
              className={profileStyles.textarea}
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              maxLength={1000}
              placeholder="Что было тяжело, что легко, самочувствие…"
              disabled={feedbackBusy}
            />
          </label>

          {feedbackError && <p className={profileStyles.error}>{feedbackError}</p>}

          <div className={profileStyles.formActions}>
            <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleFeedbackSubmit()} disabled={feedbackBusy}>
              {feedbackBusy ? "…" : "Сохранить и оценить"}
            </button>
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleFeedbackSkip()} disabled={feedbackBusy}>
              Пропустить
            </button>
          </div>
        </div>
      )}

      {showAiSection && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Оценка ИИ</h2>
          <p className={profileStyles.subtitle}>ИИ оценит эту тренировку для вас на основе посещаемости, плана, отзыва и отчёта (если есть).</p>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleAiEvaluate()} disabled={aiLoading}>
            {aiLoading ? "Оцениваю…" : "Оценить тренировку"}
          </button>
          {aiError && <p className={profileStyles.error}>{aiError}</p>}
          {aiEvaluation && <p className={profileStyles.subtitle}>{aiEvaluation}</p>}
        </div>
      )}

      {cancelChoiceOpen && (
        <div className={confirmModalStyles.backdrop} role="dialog" aria-modal="true">
          <div className={confirmModalStyles.sheet}>
            <h2 className={confirmModalStyles.title}>Отменить тренировку?</h2>
            <p className={confirmModalStyles.description}>
              Эта тренировка — часть повторяющейся серии. Отменить только её или всю серию?
            </p>
            <div className={confirmModalStyles.actions}>
              <button type="button" className={confirmModalStyles.dangerButton} onClick={() => void handleSetStatus("cancelled")} disabled={busy}>
                {busy ? "…" : "Только эту"}
              </button>
              <button type="button" className={confirmModalStyles.dangerButton} onClick={() => void handleCancelSeries()} disabled={busy}>
                {busy ? "…" : "Всю серию"}
              </button>
              <button type="button" className={confirmModalStyles.cancelButton} onClick={() => setCancelChoiceOpen(false)} disabled={busy}>
                Не отменять
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
