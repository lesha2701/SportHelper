import { useCallback, useEffect, useState } from "react";
import { deleteTemplate, getTemplate } from "../../api/taskTemplates";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import type { TaskTemplate } from "../../types/taskTemplate";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; template: TaskTemplate };

export function TaskTemplateDetail({
  token,
  templateId,
  onBack,
  onEdit,
  onDeleted,
}: {
  token: string;
  templateId: string;
  onBack: () => void;
  onEdit: (template: TaskTemplate) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getTemplate(token, templateId)
      .then((template) => setState({ status: "ready", template }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить шаблон";
        setState({ status: "error", message });
      });
  }, [token, templateId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка шаблона…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить шаблон" description={state.message} onRetry={load} />;
  }

  const { template } = state;

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteTemplate(token, template.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить шаблон");
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
        <h1 className={profileStyles.title}>{template.title}</h1>
        {template.description && <p className={profileStyles.subtitle}>{template.description}</p>}

        {template.exercises.length > 0 && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Упражнения</span>
            <span className={profileStyles.rowValue}>{template.exercises.map((e) => e.exerciseName).join(", ")}</span>
          </div>
        )}
        {template.requireMetricValue && template.metricName && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Показатель</span>
            <span className={profileStyles.rowValue}>
              {template.metricName} {template.metricTarget !== null ? `(цель: ${template.metricTarget} ${template.metricUnit ?? ""})` : ""}
            </span>
          </div>
        )}
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Формат подтверждения</span>
          <span className={profileStyles.rowValue}>
            {[
              template.requireComment && "комментарий",
              template.requirePhoto && "фото",
              template.requireVideo && "видео",
              template.requireSetsReps && "подходы/повторения",
              template.requireDuration && "длительность",
              template.requireMetricValue && "значение показателя",
              template.requireDifficulty && "сложность",
              template.requireWellbeing && "самочувствие",
            ]
              .filter(Boolean)
              .join(", ") || "кнопка «Выполнено»"}
          </span>
        </div>
      </div>

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      <p className={styles.teamMeta} style={{ padding: "0 4px" }}>
        Чтобы назначить это задание команде, откройте вкладку «Задания» внутри нужной команды и выберите «Из шаблона».
      </p>

      <div className={profileStyles.card}>
        <button type="button" className={profileStyles.buttonPrimary} onClick={() => onEdit(template)}>
          Редактировать
        </button>
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)}>
          Удалить шаблон
        </button>
      </div>

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить шаблон?"
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
