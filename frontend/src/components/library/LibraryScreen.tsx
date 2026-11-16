import { useState } from "react";
import { ExercisesScreen } from "./ExercisesScreen";
import { PlansScreen } from "./PlansScreen";
import { TaskTemplatesScreen } from "./TaskTemplatesScreen";
import styles from "../teams/teams.module.css";

type Tab = "exercises" | "plans" | "tasks";

/** `createRequest` is raised by the «Создать» button in the page heading (desktop); the open tab starts its create form. */
export function LibraryScreen({ token, createRequest }: { token: string; createRequest?: number }) {
  const [tab, setTab] = useState<Tab>("exercises");

  return (
    <>
      <div className={styles.pageTabsWrap}>
        <div className={styles.realTabBar}>
          <button type="button" className={tab === "exercises" ? styles.realTabActive : styles.realTab} onClick={() => setTab("exercises")}>
            Упражнения
          </button>
          <button type="button" className={tab === "plans" ? styles.realTabActive : styles.realTab} onClick={() => setTab("plans")}>
            Планы
          </button>
          <button type="button" className={tab === "tasks" ? styles.realTabActive : styles.realTab} onClick={() => setTab("tasks")}>
            Задания
          </button>
        </div>
      </div>

      {tab === "exercises" && <ExercisesScreen token={token} createRequest={createRequest} />}
      {tab === "plans" && <PlansScreen token={token} createRequest={createRequest} />}
      {tab === "tasks" && <TaskTemplatesScreen token={token} createRequest={createRequest} />}
    </>
  );
}
