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
      <div style={{ padding: "16px 16px 0" }}>
        <div className={styles.tabs}>
          <button type="button" className={tab === "exercises" ? styles.tabActive : styles.tab} onClick={() => setTab("exercises")}>
            Упражнения
          </button>
          <button type="button" className={tab === "plans" ? styles.tabActive : styles.tab} onClick={() => setTab("plans")}>
            Планы
          </button>
          <button type="button" className={tab === "tasks" ? styles.tabActive : styles.tab} onClick={() => setTab("tasks")}>
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
