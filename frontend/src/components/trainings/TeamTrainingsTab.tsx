import { useCallback, useEffect, useState } from "react";
import { listTeamTrainings } from "../../api/trainings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { TrainingForm } from "./TrainingForm";
import { TrainingDetail } from "./TrainingDetail";
import { TRAINING_STATUS_LABELS, isTrainingOverdue, type Training } from "../../types/training";
import styles from "../teams/teams.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; trainings: Training[] };

type View = { screen: "list" } | { screen: "create" } | { screen: "edit"; training: Training } | { screen: "detail"; trainingId: string };

export function TeamTrainingsTab({ token, teamId, canManage }: { token: string; teamId: string; canManage: boolean }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    listTeamTrainings(token, teamId)
      .then((trainings) => setState({ status: "ready", trainings }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить тренировки";
        setState({ status: "error", message });
      });
  }, [token, teamId]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <TrainingForm
        token={token}
        mode="team"
        teamId={teamId}
        onSaved={(trainings) => setView(trainings[0] ? { screen: "detail", trainingId: trainings[0].id } : { screen: "list" })}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "edit") {
    return (
      <TrainingForm
        token={token}
        mode="team"
        teamId={teamId}
        initial={view.training}
        onSaved={(trainings) => setView(trainings[0] ? { screen: "detail", trainingId: trainings[0].id } : { screen: "list" })}
        onCancel={() => setView({ screen: "detail", trainingId: view.training.id })}
        onDeleted={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <TrainingDetail
        token={token}
        trainingId={view.trainingId}
        canEdit={canManage}
        onBack={() => setView({ screen: "list" })}
        onEdit={(training) => setView({ screen: "edit", training })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка тренировок…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить тренировки" description={state.message} onRetry={load} />;
  }

  return (
    <>
      {canManage && (
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })} style={{ marginBottom: 4 }}>
          + Запланировать тренировку
        </button>
      )}

      {state.trainings.length === 0 ? (
        <StateScreen kind="empty" title="Пока нет тренировок" description="Запланируйте первую тренировку команды." />
      ) : (
        state.trainings.map((training) => (
          <button
            key={training.id}
            type="button"
            className={styles.teamCard}
            onClick={() => setView({ screen: "detail", trainingId: training.id })}
          >
            <div className={styles.teamCardTop}>
              <h2 className={styles.teamName}>
                {training.trainingDate} · {training.startTime.slice(0, 5)}
              </h2>
              <span className={styles.badge}>{TRAINING_STATUS_LABELS[training.status]}</span>
              {isTrainingOverdue(training) && <span className={`${styles.badge} ${styles.badgeWarning}`}>Просрочена</span>}
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </div>
            <p className={styles.teamMeta}>
              {training.durationMinutes} мин{training.location ? ` · ${training.location}` : ""}
            </p>
          </button>
        ))
      )}
    </>
  );
}
