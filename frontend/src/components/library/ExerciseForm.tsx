import { useState, type FormEvent } from "react";
import { createExercise, updateExercise, uploadExercisePhoto, uploadExerciseVideo } from "../../api/exercises";
import { ApiError } from "../../api/client";
import { SKILL_LEVEL_LABELS, type SkillLevel } from "../../types/profile";
import type { Exercise, ExerciseInput } from "../../types/exercise";
import { SportSelect } from "../shared/SportSelect";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import { FilePicker } from "../shared/FilePicker";
import { checkVideo, usePreviewUrl } from "../shared/pendingMedia";
import profileStyles from "../profile/profile.module.css";
import libraryStyles from "./library.module.css";

interface ExerciseFormProps {
  token: string;
  initial?: Exercise;
  onSaved: (exercise: Exercise) => void;
  onCancel: () => void;
}

export function ExerciseForm({ token, initial, onSaved, onCancel }: ExerciseFormProps) {
  const isEdit = initial !== undefined;
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [sets, setSets] = useState(initial?.sets?.toString() ?? "");
  const [reps, setReps] = useState(initial?.reps?.toString() ?? "");
  const [durationSeconds, setDurationSeconds] = useState(initial?.durationSeconds?.toString() ?? "");
  const [restSeconds, setRestSeconds] = useState(initial?.restSeconds?.toString() ?? "");
  const [equipment, setEquipment] = useState(initial?.equipment ?? "");
  const [difficulty, setDifficulty] = useState<SkillLevel | "">(initial?.difficulty ?? "");
  const [technique, setTechnique] = useState(initial?.technique ?? "");
  const [commonMistakes, setCommonMistakes] = useState(initial?.commonMistakes ?? "");
  const [warnings, setWarnings] = useState(initial?.warnings ?? "");
  const [coachComment, setCoachComment] = useState(initial?.coachComment ?? "");
  // Files picked now, uploaded right after the exercise itself is saved - no "save first, add media later".
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const photoPreview = usePreviewUrl(pendingPhoto);
  const videoPreview = usePreviewUrl(pendingVideo);
  // Set once the exercise exists on the server: if a media upload fails, "save" again continues instead of creating a duplicate.
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickVideo = async (file: File) => {
    setError(null);
    const problem = await checkVideo(file);
    if (problem) {
      setError(problem);
      return;
    }
    setPendingVideo(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    let step = "упражнение";
    try {
      const input: ExerciseInput = {
        sport: sport.trim(),
        name: name.trim(),
        description: description.trim() || null,
        goal: goal.trim() || null,
        sets: sets ? Number(sets) : null,
        reps: reps ? Number(reps) : null,
        duration_seconds: durationSeconds ? Number(durationSeconds) : null,
        rest_seconds: restSeconds ? Number(restSeconds) : null,
        equipment: equipment.trim() || null,
        difficulty: difficulty || null,
        technique: technique.trim() || null,
        common_mistakes: commonMistakes.trim() || null,
        warnings: warnings.trim() || null,
        coach_comment: coachComment.trim() || null,
      };
      let exercise = savedId ? await updateExercise(token, savedId, input) : await createExercise(token, input);
      setSavedId(exercise.id);
      step = "фото";
      if (pendingPhoto) {
        exercise = await uploadExercisePhoto(token, exercise.id, pendingPhoto);
        setPendingPhoto(null);
      }
      step = "видео";
      if (pendingVideo) {
        exercise = await uploadExerciseVideo(token, exercise.id, pendingVideo);
        setPendingVideo(null);
      }
      onSaved(exercise);
    } catch (err) {
      if (step !== "упражнение") {
        const reason = err instanceof ApiError ? err.message : "неизвестная ошибка";
        setError(`Упражнение сохранено, но не удалось загрузить ${step}: ${reason} Исправьте и нажмите «Сохранить» ещё раз.`);
      } else if (err instanceof ApiError && err.code === "coach_profile_required") {
        setError("Сначала заполните профиль тренера в разделе «Профиль».");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить упражнение");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={profileStyles.screen} onSubmit={handleSubmit}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>{isEdit ? "Редактировать упражнение" : "Новое упражнение"}</h1>
        <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>

        <SportSelect value={sport} onChange={setSport} />

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>
            Название<span className={profileStyles.requiredMark}>*</span>
          </span>
          <input className={profileStyles.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Фото и видео</span>
          {photoPreview && <img className={libraryStyles.exercisePhoto} src={photoPreview} alt="Выбранное фото" />}
          <FilePicker
            icon="image"
            label={pendingPhoto ? pendingPhoto.name : initial?.photoFileId ? "Заменить фотографию" : "Добавить фотографию"}
            hint="JPEG, PNG, WEBP или GIF — загрузится вместе с упражнением"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onSelect={(file) => {
              setError(null);
              setPendingPhoto(file);
            }}
            disabled={saving}
          />
          {pendingPhoto && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setPendingPhoto(null)} disabled={saving}>
              Убрать выбранное фото
            </button>
          )}
          {videoPreview && <video className={libraryStyles.exerciseVideo} src={videoPreview} controls preload="metadata" />}
          <FilePicker
            icon="video"
            label={pendingVideo ? pendingVideo.name : initial?.videoFileId ? "Заменить видео" : "Добавить видео"}
            hint="MP4, MOV или WEBM, до 1 минуты и 100 МБ"
            accept="video/mp4,video/quicktime,video/webm"
            onSelect={(file) => void pickVideo(file)}
            disabled={saving}
          />
          {pendingVideo && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setPendingVideo(null)} disabled={saving}>
              Убрать выбранное видео
            </button>
          )}
        </div>

        <CollapsibleSection label="Показать ещё поля" openLabel="Скрыть дополнительные поля" defaultOpen={isEdit}>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Цель</span>
          <input className={profileStyles.input} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} />
        </label>

        <div className={profileStyles.fieldGrid}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Подходы</span>
            <input className={profileStyles.input} type="number" min={0} max={100} value={sets} onChange={(e) => setSets(e.target.value)} />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Повторения</span>
            <input className={profileStyles.input} type="number" min={0} max={1000} value={reps} onChange={(e) => setReps(e.target.value)} />
          </label>
        </div>

        <div className={profileStyles.fieldGrid}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Длительность, сек</span>
            <input
              className={profileStyles.input}
              type="number"
              min={0}
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
            />
          </label>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Отдых, сек</span>
            <input className={profileStyles.input} type="number" min={0} value={restSeconds} onChange={(e) => setRestSeconds(e.target.value)} />
          </label>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Инвентарь</span>
          <input className={profileStyles.input} value={equipment} onChange={(e) => setEquipment(e.target.value)} maxLength={500} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Сложность</span>
          <select className={profileStyles.select} value={difficulty} onChange={(e) => setDifficulty(e.target.value as SkillLevel | "")}>
            <option value="">Не указана</option>
            {Object.entries(SKILL_LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Техника выполнения</span>
          <textarea className={profileStyles.textarea} value={technique} onChange={(e) => setTechnique(e.target.value)} maxLength={2000} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Типичные ошибки</span>
          <textarea
            className={profileStyles.textarea}
            value={commonMistakes}
            onChange={(e) => setCommonMistakes(e.target.value)}
            maxLength={2000}
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Предупреждения</span>
          <textarea className={profileStyles.textarea} value={warnings} onChange={(e) => setWarnings(e.target.value)} maxLength={1000} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Комментарий тренера</span>
          <textarea className={profileStyles.textarea} value={coachComment} onChange={(e) => setCoachComment(e.target.value)} maxLength={1000} />
        </label>

        </CollapsibleSection>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="submit" className={profileStyles.buttonPrimary} disabled={saving}>
            {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать упражнение"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onCancel} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
