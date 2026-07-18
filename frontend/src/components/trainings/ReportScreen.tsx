import { useCallback, useEffect, useState } from "react";
import { getReport, reviewReport, submitReport, uploadReportPhoto, uploadReportVideo } from "../../api/reports";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { FilePicker } from "../shared/FilePicker";
import { Icon } from "../shared/Icon";
import { REPORT_STATUS_LABELS, type Report } from "../../types/report";
import type { Training } from "../../types/training";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libraryStyles from "../library/library.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; report: Report };

export function ReportScreen({
  token,
  training,
  canReview,
  onBack,
}: {
  token: string;
  training: Training;
  canReview: boolean;
  onBack: () => void;
}) {
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const isResponsible = myUserId !== null && training.responsibleUserId === myUserId;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [textReport, setTextReport] = useState("");
  const [coachComment, setCoachComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getReport(token, training.id)
      .then((report) => {
        setState({ status: "ready", report });
        setTextReport(report.textReport);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "not_found") {
          setState({ status: "empty" });
          return;
        }
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить отчёт";
        setState({ status: "error", message });
      });
  }, [token, training.id]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка отчёта…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить отчёт" description={state.message} onRetry={load} />;
  }

  const report = state.status === "ready" ? state.report : null;

  const handleSubmit = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await submitReport(token, training.id, textReport.trim());
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось отправить отчёт");
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async (decision: "accepted" | "needs_revision") => {
    setBusy(true);
    setActionError(null);
    try {
      await reviewReport(token, training.id, decision, coachComment.trim() || null);
      setCoachComment("");
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось сохранить решение");
    } finally {
      setBusy(false);
    }
  };

  const handlePhotoChange = async (file: File) => {
    setBusy(true);
    setActionError(null);
    try {
      await uploadReportPhoto(token, training.id, file);
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
      await uploadReportVideo(token, training.id, file);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
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

      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Отчёт о тренировке</h1>
        {report && <span className={styles.badge}>{REPORT_STATUS_LABELS[report.status]}</span>}
      </div>

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      {state.status === "empty" && !isResponsible && (
        <StateScreen kind="empty" title="Отчёт ещё не отправлен" description="Ответственный игрок пока не написал отчёт об этой тренировке." />
      )}

      {isResponsible && (
        <div className={profileStyles.card}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Короткий отчёт</span>
            <textarea
              className={profileStyles.textarea}
              value={textReport}
              onChange={(e) => setTextReport(e.target.value)}
              maxLength={2000}
              placeholder="Как прошла тренировка, кто отсутствовал, что стоит отметить тренеру"
            />
          </label>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSubmit()} disabled={busy || !textReport.trim()}>
            {report ? "Обновить отчёт" : "Отправить отчёт"}
          </button>

          {report && (
            <>
              <FilePicker
                icon="image"
                label="Фотография (необязательно)"
                hint="JPEG, PNG, WEBP или GIF"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onSelect={(file) => void handlePhotoChange(file)}
                disabled={busy}
              />
              <FilePicker
                icon="video"
                label="Видео (необязательно)"
                hint="MP4, MOV или WEBM"
                accept="video/mp4,video/quicktime,video/webm"
                onSelect={(file) => void handleVideoChange(file)}
                disabled={busy}
              />
            </>
          )}
        </div>
      )}

      {report && !isResponsible && (
        <div className={profileStyles.card}>
          <p className={profileStyles.rowValue}>{report.textReport}</p>
        </div>
      )}

      {report && (report.photoFileId || report.videoFileId) && (
        <div className={profileStyles.card}>
          {report.photoFileId && <AuthenticatedImage token={token} fileId={report.photoFileId} alt="Фото отчёта" className={libraryStyles.exercisePhoto} />}
          {report.videoFileId && <AuthenticatedVideo token={token} fileId={report.videoFileId} className={libraryStyles.exerciseVideo} />}
        </div>
      )}

      {report && report.coachComment && (
        <div className={profileStyles.card}>
          <span className={profileStyles.label}>Комментарий тренера</span>
          <p className={profileStyles.rowValue}>{report.coachComment}</p>
        </div>
      )}

      {report && canReview && (
        <div className={profileStyles.card}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Комментарий (необязательно)</span>
            <textarea className={profileStyles.textarea} value={coachComment} onChange={(e) => setCoachComment(e.target.value)} maxLength={1000} />
          </label>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleReview("accepted")} disabled={busy}>
            Принять отчёт
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleReview("needs_revision")} disabled={busy}>
            Вернуть на доработку
          </button>
        </div>
      )}
    </div>
  );
}
