import { useCallback, useEffect, useState } from "react";
import { listMyTemplates, deleteTemplate } from "../../api/taskTemplates";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";
import { TaskTemplateForm } from "./TaskTemplateForm";
import { TaskTemplateDetail } from "./TaskTemplateDetail";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import type { TaskTemplate } from "../../types/taskTemplate";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libStyles from "./library.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; templates: TaskTemplate[] };

type View =
  | { screen: "list" }
  | { screen: "create" }
  | { screen: "edit"; template: TaskTemplate }
  | { screen: "detail"; templateId: string };

const REQUIREMENT_LABELS: Array<[keyof TaskTemplate, string]> = [
  ["requireComment", "Комментарий"],
  ["requirePhoto", "Фото"],
  ["requireVideo", "Видео"],
  ["requireSetsReps", "Подходы и повторы"],
  ["requireDuration", "Длительность"],
  ["requireMetricValue", "Значение показателя"],
  ["requireDifficulty", "Сложность"],
  ["requireWellbeing", "Самочувствие"],
];

function TemplateDetailPanel({
  template,
  onEdit,
  onOpenFull,
  onDeleted,
  token,
}: {
  template: TaskTemplate;
  onEdit: () => void;
  onOpenFull: () => void;
  onDeleted: () => void;
  token: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequirements = REQUIREMENT_LABELS.filter(([key]) => template[key] === true);

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteTemplate(token, template.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить шаблон");
      setBusy(false);
    }
  };

  return (
    <div className={libStyles.detailPanel}>
      <div className={libStyles.detailBody} style={{ paddingTop: 20 }}>
        <div>
          <span className={libStyles.detailCategory}>Шаблон задания</span>
          <h2 className={libStyles.detailTitle}>{template.title}</h2>
        </div>
        <p className={libStyles.detailDescription}>{template.description || "Без описания."}</p>

        <div className={libStyles.detailStatsGrid}>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{template.exercises.length}</span>
            <span className={libStyles.detailStatLabel}>упражнений</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>
              {template.metricTarget !== null ? `${template.metricTarget} ${template.metricUnit ?? ""}`.trim() : "—"}
            </span>
            <span className={libStyles.detailStatLabel}>{template.metricName ?? "цель"}</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{activeRequirements.length}</span>
            <span className={libStyles.detailStatLabel}>подтверждений</span>
          </div>
        </div>

        {template.exercises.length > 0 && (
          <div className={libStyles.detailExerciseList}>
            {template.exercises
              .slice()
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((te, i) => (
                <div key={te.id} className={libStyles.detailExerciseRow}>
                  <span className={libStyles.detailExerciseIndex}>{i + 1}</span>
                  <span className={libStyles.detailExerciseName}>{te.exerciseName ?? "Упражнение"}</span>
                </div>
              ))}
          </div>
        )}

        <div>
          <span className={libStyles.detailSharedLabel}>Формат подтверждения</span>
          <div className={libStyles.detailSharedRow} style={{ marginTop: 8 }}>
            {activeRequirements.length === 0 ? (
              <span className={profileStyles.subtitle} style={{ margin: 0 }}>
                Не задано.
              </span>
            ) : (
              activeRequirements.map(([key, label]) => (
                <span key={key} className={libStyles.reqChipActive}>
                  {label}
                </span>
              ))
            )}
          </div>
        </div>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={libStyles.detailActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onEdit}>
            Изменить
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setConfirmOpen(true)}>
            Удалить
          </button>
        </div>
        <button type="button" className={libStyles.detailAddTeamChip} style={{ alignSelf: "center" }} onClick={onOpenFull}>
          Подробнее →
        </button>
      </div>

      {confirmOpen && (
        <ConfirmModal
          title="Удалить шаблон?"
          danger
          busy={busy}
          confirmLabel="Удалить"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

export function TaskTemplatesScreen({ token }: { token: string }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    listMyTemplates(token)
      .then((templates) => setState({ status: "ready", templates }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить шаблоны";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <TaskTemplateForm token={token} onSaved={(t) => setView({ screen: "detail", templateId: t.id })} onCancel={() => setView({ screen: "list" })} />
    );
  }

  if (view.screen === "edit") {
    return (
      <TaskTemplateForm
        token={token}
        initial={view.template}
        onSaved={(t) => setView({ screen: "detail", templateId: t.id })}
        onCancel={() => setView({ screen: "detail", templateId: view.template.id })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <TaskTemplateDetail
        token={token}
        templateId={view.templateId}
        onBack={() => setView({ screen: "list" })}
        onEdit={(t) => setView({ screen: "edit", template: t })}
        onDeleted={() => setView({ screen: "list" })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка шаблонов…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить шаблоны" description={state.message} onRetry={load} />;
  }

  const filtered = state.templates.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q);
  });

  const selected = filtered.find((t) => t.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Шаблоны заданий</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          <Icon name="plus" size={16} />
          Создать
        </button>
      </div>

      {state.templates.length > 0 && (
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {state.templates.length === 0 ? (
        <StateScreen
          kind="empty"
          title="Пока нет шаблонов"
          description="Соберите шаблон один раз — потом сможете быстро назначить его любой команде из вкладки «Задания»."
        />
      ) : filtered.length === 0 ? (
        <StateScreen kind="empty" title="Ничего не найдено" description="Попробуйте изменить запрос." />
      ) : (
        <div className={libStyles.libraryLayout}>
          <div className={libStyles.libraryMain}>
            <div className={libStyles.resultCount} style={{ marginLeft: 0 }}>
              {filtered.length} шаблонов
            </div>
            <div className={libStyles.exerciseGrid}>
              {filtered.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={libStyles.libCard}
                  onClick={() => (isDesktop ? setSelectedId(template.id) : setView({ screen: "detail", templateId: template.id }))}
                >
                  <span className={libStyles.libCardIcon}>
                    <Icon name="flag" size={19} />
                  </span>
                  <h2 className={libStyles.libCardTitle}>{template.title}</h2>
                  {template.description && <p className={libStyles.libCardMeta}>{template.description}</p>}
                  <div className={libStyles.libCardFooter}>
                    <span>{template.exercises.length} упражнений</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {isDesktop && selected && (
            <TemplateDetailPanel
              token={token}
              template={selected}
              onEdit={() => setView({ screen: "edit", template: selected })}
              onOpenFull={() => setView({ screen: "detail", templateId: selected.id })}
              onDeleted={load}
            />
          )}
        </div>
      )}
    </div>
  );
}
