import { useCallback, useEffect, useState } from "react";
import { listTeamTasks } from "../../api/tasks";
import { listMyTemplates } from "../../api/taskTemplates";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { StateScreen } from "../StateScreen";
import { TaskForm } from "./TaskForm";
import { TaskDetail } from "./TaskDetail";
import { TASK_STATUS_LABELS, type Task } from "../../types/task";
import type { TaskTemplate } from "../../types/taskTemplate";
import styles from "../teams/teams.module.css";
import profileStyles from "../profile/profile.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tasks: Task[] };

type View =
  | { screen: "list" }
  | { screen: "create"; prefill?: TaskTemplate }
  | { screen: "pick-template" }
  | { screen: "edit"; task: Task }
  | { screen: "detail"; taskId: string };

export function TeamTasksTab({ token, teamId, canManage }: { token: string; teamId: string; canManage: boolean }) {
  const { state: authState } = useAuth();
  const myUserId = authState.status === "ready" ? authState.user.id : null;

  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    listTeamTasks(token, teamId)
      .then((tasks) => setState({ status: "ready", tasks }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить задания";
        setState({ status: "error", message });
      });
  }, [token, teamId]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <TaskForm
        token={token}
        teamId={teamId}
        prefill={view.prefill}
        onSaved={(task) => setView({ screen: "detail", taskId: task.id })}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "pick-template") {
    return (
      <TemplatePicker
        token={token}
        onPick={(template) => setView({ screen: "create", prefill: template })}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "edit") {
    return (
      <TaskForm
        token={token}
        teamId={teamId}
        initial={view.task}
        onSaved={(task) => setView({ screen: "detail", taskId: task.id })}
        onCancel={() => setView({ screen: "detail", taskId: view.task.id })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <TaskDetail
        token={token}
        taskId={view.taskId}
        canManage={canManage}
        onBack={() => setView({ screen: "list" })}
        onEdit={(task) => setView({ screen: "edit", task })}
        onDeleted={() => setView({ screen: "list" })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка заданий…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить задания" description={state.message} onRetry={load} />;
  }

  return (
    <>
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
            + Новое задание
          </button>
          <button type="button" className={styles.iconButton} onClick={() => setView({ screen: "pick-template" })}>
            Из шаблона
          </button>
        </div>
      )}

      {state.tasks.length === 0 ? (
        <StateScreen kind="empty" title="Пока нет заданий" description={canManage ? "Назначьте первое задание команде." : "Тренер ещё не назначил вам заданий."} />
      ) : (
        state.tasks.map((task) => {
          const mine = task.assignments.find((a) => a.userId === myUserId);
          return (
            <button key={task.id} type="button" className={styles.teamCard} onClick={() => setView({ screen: "detail", taskId: task.id })}>
              <div className={styles.teamCardTop}>
                <h2 className={styles.teamName}>{task.title}</h2>
                {!canManage && mine && <span className={styles.badge}>{TASK_STATUS_LABELS[mine.status]}</span>}
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </div>
              {canManage && <p className={styles.teamMeta}>Игроков: {task.assignments.length}</p>}
              {task.deadline && <p className={styles.teamMeta}>Дедлайн: {new Date(task.deadline).toLocaleDateString("ru-RU")}</p>}
            </button>
          );
        })
      )}
    </>
  );
}

function TemplatePicker({
  token,
  onPick,
  onCancel,
}: {
  token: string;
  onPick: (template: TaskTemplate) => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyTemplates(token)
      .then(setTemplates)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить шаблоны"));
  }, [token]);

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onCancel}>
          ← Назад
        </button>
      </div>

      <h2 className={styles.heading}>Выберите шаблон</h2>
      {error && <p className={profileStyles.error}>{error}</p>}

      {templates !== null && templates.length === 0 && (
        <StateScreen kind="empty" title="Пока нет шаблонов" description="Создайте шаблон задания в разделе «Библиотека» → «Задания»." />
      )}

      {templates?.map((template) => (
        <button key={template.id} type="button" className={styles.teamCard} onClick={() => onPick(template)}>
          <div className={styles.teamCardTop}>
            <h3 className={styles.teamName}>{template.title}</h3>
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </div>
          {template.description && <p className={styles.teamMeta}>{template.description}</p>}
        </button>
      ))}
    </div>
  );
}
