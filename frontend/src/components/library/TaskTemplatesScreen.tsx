import { useCallback, useEffect, useState } from "react";
import { listMyTemplates } from "../../api/taskTemplates";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { TaskTemplateForm } from "./TaskTemplateForm";
import { TaskTemplateDetail } from "./TaskTemplateDetail";
import type { TaskTemplate } from "../../types/taskTemplate";
import styles from "../teams/teams.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; templates: TaskTemplate[] };

type View =
  | { screen: "list" }
  | { screen: "create" }
  | { screen: "edit"; template: TaskTemplate }
  | { screen: "detail"; templateId: string };

export function TaskTemplatesScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });

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

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Шаблоны заданий</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          <Icon name="plus" size={16} />
          Создать
        </button>
      </div>

      {state.templates.length === 0 ? (
        <StateScreen
          kind="empty"
          title="Пока нет шаблонов"
          description="Соберите шаблон один раз — потом сможете быстро назначить его любой команде из вкладки «Задания»."
        />
      ) : (
        state.templates.map((template) => (
          <button key={template.id} type="button" className={styles.teamCard} onClick={() => setView({ screen: "detail", templateId: template.id })}>
            <div className={styles.teamCardRow}>
              <div className={styles.teamAvatar}>
                <Icon name="flag" size={19} />
              </div>
              <div className={styles.teamNameCol}>
                <div className={styles.teamCardTop}>
                  <h2 className={styles.teamName}>{template.title}</h2>
                  <span className={styles.chevron} aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                </div>
                {template.description && <p className={styles.teamMeta}>{template.description}</p>}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
