import { useCallback, useEffect, useState } from "react";
import {
  deleteTask,
  getTask,
  reviewTask,
  startTask,
  submitTask,
  uploadTaskPhoto,
  uploadTaskVideo,
} from "../../api/tasks";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { FilePicker } from "../shared/FilePicker";
import { Icon } from "../shared/Icon";
import { TASK_STATUS_LABELS, TASK_TARGET_LABELS, type Task, type TaskAssignment } from "../../types/task";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libraryStyles from "../library/library.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; task: Task };

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TaskDetail({
  token,
  taskId,
  canManage,
  onBack,
  onEdit,
  onDeleted,
}: {
  token: string;
  taskId: string;
  canManage: boolean;
  onBack: () => void;
  onEdit: (task: Task) => void;
  onDeleted: () => void;
}) {
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [wellbeing, setWellbeing] = useState("");
  const [coachComment, setCoachComment] = useState("");

  const load = useCallback(() => {
    setState({ status: "loading" });
    getTask(token, taskId)
      .then((task) => setState({ status: "ready", task }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить задание";
        setState({ status: "error", message });
      });
  }, [token, taskId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const mine = state.task.assignments.find((a) => a.userId === myUserId);
    if (mine) setComment(mine.comment ?? "");
  }, [state, myUserId]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка задания…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить задание" description={state.message} onRetry={load} />;
  }

  const { task } = state;
  const myAssignment = task.assignments.find((a) => a.userId === myUserId) ?? null;
  const deadlineLabel = formatDeadline(task.deadline);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteTask(token, task.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить задание");
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await startTask(token, task.id);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось начать выполнение");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await submitTask(token, task.id, {
        comment: task.requireComment ? comment.trim() || null : comment.trim() || null,
        sets: sets ? Number(sets) : null,
        reps: reps ? Number(reps) : null,
        duration_minutes: durationMinutes ? Number(durationMinutes) : null,
        metric_value: metricValue ? Number(metricValue) : null,
        difficulty: difficulty ? Number(difficulty) : null,
        wellbeing: wellbeing ? Number(wellbeing) : null,
      });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось отправить отчёт");
    } finally {
      setBusy(false);
    }
  };

  const handlePhotoChange = async (file: File) => {
    setBusy(true);
    setActionError(null);
    try {
      await uploadTaskPhoto(token, task.id, file);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  };

  const handleVideoChange = async (file: File) => {
    setBusy(true);
    setActionError(null);
    try {
      await uploadTaskVideo(token, task.id, file);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async (userId: string, decision: "accepted" | "needs_revision") => {
    setBusy(true);
    setActionError(null);
    try {
      await reviewTask(token, task.id, userId, decision, coachComment.trim() || null);
      setCoachComment("");
      setExpandedUserId(null);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось сохранить решение");
    } finally {
      setBusy(false);
    }
  };

  const renderAssignmentBody = (a: TaskAssignment) => (
    <>
      {a.comment && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Комментарий</span>
          <span className={profileStyles.rowValue}>{a.comment}</span>
        </div>
      )}
      {(a.sets !== null || a.reps !== null) && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Подходы / повторения</span>
          <span className={profileStyles.rowValue}>{a.sets ?? "—"} / {a.reps ?? "—"}</span>
        </div>
      )}
      {a.durationMinutes !== null && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Длительность</span>
          <span className={profileStyles.rowValue}>{a.durationMinutes} мин</span>
        </div>
      )}
      {a.metricValue !== null && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>{task.metricName ?? "Показатель"}</span>
          <span className={profileStyles.rowValue}>
            {a.metricValue} {task.metricUnit ?? ""}
          </span>
        </div>
      )}
      {a.difficulty !== null && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Сложность</span>
          <span className={profileStyles.rowValue}>{a.difficulty} / 10</span>
        </div>
      )}
      {a.wellbeing !== null && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Самочувствие</span>
          <span className={profileStyles.rowValue}>{a.wellbeing} / 5</span>
        </div>
      )}
      {(a.photoFileId || a.videoFileId) && (
        <>
          {a.photoFileId && <AuthenticatedImage token={token} fileId={a.photoFileId} alt="Фото отчёта" className={libraryStyles.exercisePhoto} />}
          {a.videoFileId && <AuthenticatedVideo token={token} fileId={a.videoFileId} className={libraryStyles.exerciseVideo} />}
        </>
      )}
      {a.coachComment && (
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Комментарий тренера</span>
          <span className={profileStyles.rowValue}>{a.coachComment}</span>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <div className={styles.teamCardTop}>
          <h1 className={profileStyles.title}>{task.title}</h1>
          {!canManage && myAssignment && <span className={styles.badge}>{TASK_STATUS_LABELS[myAssignment.status]}</span>}
        </div>
        {task.description && <p className={profileStyles.subtitle}>{task.description}</p>}
        {deadlineLabel && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Дедлайн</span>
            <span className={profileStyles.rowValue}>{deadlineLabel}</span>
          </div>
        )}
        {canManage && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Кому назначено</span>
            <span className={profileStyles.rowValue}>
              {TASK_TARGET_LABELS[task.targetType]}
              {task.targetType === "position" && task.targetPosition ? ` (${task.targetPosition})` : ""}
            </span>
          </div>
        )}
        {task.exercises.length > 0 && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Упражнения</span>
            <span className={profileStyles.rowValue}>{task.exercises.map((e) => e.exerciseName).join(", ")}</span>
          </div>
        )}
        {task.requireMetricValue && task.metricName && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Показатель</span>
            <span className={profileStyles.rowValue}>
              {task.metricName} {task.metricTarget !== null ? `(цель: ${task.metricTarget} ${task.metricUnit ?? ""})` : ""}
            </span>
          </div>
        )}
      </div>

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {canManage && (
        <div className={profileStyles.card}>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => onEdit(task)}>
            Редактировать
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)}>
            Удалить задание
          </button>
        </div>
      )}

      {canManage && (
        <div className={profileStyles.card}>
          <span className={profileStyles.title}>Игроки ({task.assignments.length})</span>
          {task.assignments.map((a) => (
            <div key={a.userId}>
              <button
                type="button"
                className={styles.memberRow}
                style={{ cursor: "pointer", textAlign: "left", width: "100%" }}
                onClick={() => setExpandedUserId(expandedUserId === a.userId ? null : a.userId)}
              >
                {a.photoUrl ? <img className={styles.avatar} src={a.photoUrl} alt="" /> : <div className={styles.avatar} />}
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>
                    {a.firstName} {a.lastName ?? ""}
                  </span>
                </div>
                <span className={styles.badge}>{TASK_STATUS_LABELS[a.status]}</span>
              </button>
              {expandedUserId === a.userId && (
                <div className={profileStyles.card} style={{ marginTop: 4 }}>
                  {renderAssignmentBody(a)}
                  <label className={profileStyles.field}>
                    <span className={profileStyles.label}>Комментарий тренера (необязательно)</span>
                    <textarea className={profileStyles.textarea} value={coachComment} onChange={(e) => setCoachComment(e.target.value)} maxLength={1000} />
                  </label>
                  <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleReview(a.userId, "accepted")} disabled={busy}>
                    Принять
                  </button>
                  <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleReview(a.userId, "needs_revision")} disabled={busy}>
                    Вернуть на доработку
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!canManage && myAssignment && (
        <div className={profileStyles.card}>
          {(myAssignment.status === "assigned" || myAssignment.status === "viewed") && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleStart()} disabled={busy}>
              Начать выполнение
            </button>
          )}

          {renderAssignmentBody(myAssignment)}

          {myAssignment.status !== "accepted" && myAssignment.status !== "cancelled" && (
            <>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>
                  Комментарий{task.requireComment && <span className={profileStyles.requiredMark}>*</span>}
                </span>
                <textarea className={profileStyles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
              </label>

              {task.requireSetsReps && (
                <div className={profileStyles.fieldGrid}>
                  <label className={profileStyles.field}>
                    <span className={profileStyles.label}>
                      Подходы<span className={profileStyles.requiredMark}>*</span>
                    </span>
                    <input className={profileStyles.input} type="number" min={0} value={sets} onChange={(e) => setSets(e.target.value)} />
                  </label>
                  <label className={profileStyles.field}>
                    <span className={profileStyles.label}>
                      Повторения<span className={profileStyles.requiredMark}>*</span>
                    </span>
                    <input className={profileStyles.input} type="number" min={0} value={reps} onChange={(e) => setReps(e.target.value)} />
                  </label>
                </div>
              )}

              {task.requireDuration && (
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    Длительность, мин<span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <input className={profileStyles.input} type="number" min={0} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
                </label>
              )}

              {task.requireMetricValue && (
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    {task.metricName ?? "Значение показателя"}
                    <span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <input className={profileStyles.input} type="number" value={metricValue} onChange={(e) => setMetricValue(e.target.value)} />
                </label>
              )}

              {task.requireDifficulty && (
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    Сложность, 1–10<span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <input className={profileStyles.input} type="number" min={1} max={10} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
                </label>
              )}

              {task.requireWellbeing && (
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    Самочувствие, 1–5<span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <input className={profileStyles.input} type="number" min={1} max={5} value={wellbeing} onChange={(e) => setWellbeing(e.target.value)} />
                </label>
              )}

              {task.requirePhoto && (
                <div className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    Фото<span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <FilePicker
                    icon="image"
                    label="Выбрать фото"
                    hint="JPEG, PNG, WEBP или GIF"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onSelect={(file) => void handlePhotoChange(file)}
                    disabled={busy}
                  />
                </div>
              )}

              {task.requireVideo && (
                <div className={profileStyles.field}>
                  <span className={profileStyles.label}>
                    Видео<span className={profileStyles.requiredMark}>*</span>
                  </span>
                  <FilePicker
                    icon="video"
                    label="Выбрать видео"
                    hint="MP4, MOV или WEBM"
                    accept="video/mp4,video/quicktime,video/webm"
                    onSelect={(file) => void handleVideoChange(file)}
                    disabled={busy}
                  />
                </div>
              )}

              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSubmit()} disabled={busy}>
                {myAssignment.status === "needs_revision" ? "Отправить повторно" : "Отметить выполненным"}
              </button>
            </>
          )}
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить задание?"
          description="Задание будет отменено у всех игроков, которым оно назначено."
          danger
          busy={busy}
          confirmLabel="Удалить"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}
