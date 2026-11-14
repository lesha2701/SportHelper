import { useState } from "react";
import { ExercisesScreen } from "./ExercisesScreen";
import { PlansScreen } from "./PlansScreen";
import { TaskTemplatesScreen } from "./TaskTemplatesScreen";
import styles from "../teams/teams.module.css";

type Tab = "exercises" | "plans" | "tasks";

export function LibraryScreen({ token }: { token: string }) {
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

      {tab === "exercises" && <ExercisesScreen token={token} />}
      {tab === "plans" && <PlansScreen token={token} />}
      {tab === "tasks" && <TaskTemplatesScreen token={token} />}
    </>
  );
}
