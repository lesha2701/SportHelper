import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteExercise,
  getExercise,
  shareExercise,
  unshareExercise,
  uploadExercisePhoto,
  uploadExerciseVideo,
} from "../../api/exercises";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { Exercise } from "../../types/exercise";
import type { Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libraryStyles from "./library.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; exercise: Exercise };

export function ExerciseDetail({
  token,
  exerciseId,
  isOwner,
  onBack,
  onEdit,
  onDeleted,
}: {
  token: string;
  exerciseId: string;
  isOwner: boolean;
  onBack: () => void;
  onEdit: (exercise: Exercise) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [myCoachTeams, setMyCoachTeams] = useState<Team[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getExercise(token, exerciseId)
      .then((exercise) => setState({ status: "ready", exercise }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить упражнение";
        setState({ status: "error", message });
      });
  }, [token, exerciseId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!isOwner) return;
    listMyTeams(token)
      .then((teams) => setMyCoachTeams(teams.filter((t) => t.myRole === "head_coach" || t.myRole === "assistant_coach")))
      .catch(() => setMyCoachTeams([]));
  }, [token, isOwner]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка упражнения…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить упражнение" description={state.message} onRetry={load} />;
  }

  const { exercise } = state;

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setActionError(null);
    try {
      await uploadExercisePhoto(token, exercise.id, file);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleVideoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setActionError(null);
    try {
      await uploadExerciseVideo(token, exercise.id, file);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
    } finally {
      setBusy(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  };

  const toggleShare = async (teamId: string, shared: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      if (shared) {
        await unshareExercise(token, exercise.id, teamId);
      } else {
        await shareExercise(token, exercise.id, teamId);
      }
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось изменить видимость");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteExercise(token, exercise.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить упражнение");
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
        <h1 className={profileStyles.title}>{exercise.name}</h1>
        <p className={profileStyles.subtitle}>{exercise.sport}</p>

        {exercise.photoFileId && (
          <AuthenticatedImage token={token} fileId={exercise.photoFileId} alt={exercise.name} className={libraryStyles.exercisePhoto} />
        )}
        {exercise.videoFileId && <AuthenticatedVideo token={token} fileId={exercise.videoFileId} className={libraryStyles.exerciseVideo} />}

        {exercise.description && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Описание</span>
            <span className={profileStyles.rowValue}>{exercise.description}</span>
          </div>
        )}
        {exercise.goal && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Цель</span>
            <span className={profileStyles.rowValue}>{exercise.goal}</span>
          </div>
        )}
        {exercise.difficulty && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Сложность</span>
            <span className={profileStyles.rowValue}>{SKILL_LEVEL_LABELS[exercise.difficulty]}</span>
          </div>
        )}
        {exercise.sets !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Подходы</span>
            <span className={profileStyles.rowValue}>{exercise.sets}</span>
          </div>
        )}
        {exercise.reps !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Повторения</span>
            <span className={profileStyles.rowValue}>{exercise.reps}</span>
          </div>
        )}
        {exercise.durationSeconds !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Длительность</span>
            <span className={profileStyles.rowValue}>{exercise.durationSeconds} сек</span>
          </div>
        )}
        {exercise.restSeconds !== null && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Отдых</span>
            <span className={profileStyles.rowValue}>{exercise.restSeconds} сек</span>
          </div>
        )}
        {exercise.equipment && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Инвентарь</span>
            <span className={profileStyles.rowValue}>{exercise.equipment}</span>
          </div>
        )}
        {exercise.technique && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Техника</span>
            <span className={profileStyles.rowValue}>{exercise.technique}</span>
          </div>
        )}
        {exercise.commonMistakes && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Типичные ошибки</span>
            <span className={profileStyles.rowValue}>{exercise.commonMistakes}</span>
          </div>
        )}
        {exercise.warnings && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Предупреждения</span>
            <span className={profileStyles.rowValue}>{exercise.warnings}</span>
          </div>
        )}
        {exercise.coachComment && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Комментарий тренера</span>
            <span className={profileStyles.rowValue}>{exercise.coachComment}</span>
          </div>
        )}
      </div>

      {isOwner && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Медиа</h2>
          {actionError && <p className={profileStyles.error}>{actionError}</p>}
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Фотография</span>
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void handlePhotoChange(e)} disabled={busy} />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Видео</span>
            <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => void handleVideoChange(e)} disabled={busy} />
          </label>
        </div>
      )}

      {isOwner && myCoachTeams.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Показать командам</h2>
          <p className={profileStyles.subtitle}>Участники увидят упражнение как необязательный материал.</p>
          {myCoachTeams.map((team) => {
            const shared = exercise.sharedTeamIds.includes(team.id);
            return (
              <button
                key={team.id}
                type="button"
                className={shared ? styles.badge : styles.iconButton}
                style={{ marginRight: 8, marginBottom: 8 }}
                onClick={() => void toggleShare(team.id, shared)}
                disabled={busy}
              >
                {shared ? "✓ " : ""}
                {team.name}
              </button>
            );
          })}
        </div>
      )}

      {isOwner && (
        <div className={profileStyles.card}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => onEdit(exercise)}>
            Редактировать
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)}>
            Удалить упражнение
          </button>
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить упражнение?"
          description="Упражнение исчезнет из библиотеки. Уже созданные планы, использующие его, сохранят название, но упражнение станет недоступно для новых."
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
