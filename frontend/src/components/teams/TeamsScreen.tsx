import { useCallback, useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { CreateTeamForm } from "./CreateTeamForm";
import { TeamDetailScreen } from "./TeamDetailScreen";
import { TEAM_ROLE_LABELS, type Team } from "../../types/team";
import styles from "./teams.module.css";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; teams: Team[] };

type View = { screen: "list" } | { screen: "create" } | { screen: "detail"; teamId: string };

export function TeamsScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    listMyTeams(token)
      .then((teams) => setState({ status: "ready", teams }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить команды";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(() => {
    if (view.screen === "list") {
      load();
    }
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <CreateTeamForm
        token={token}
        onCreated={(team) => setView({ screen: "detail", teamId: team.id })}
        onCancel={() => setView({ screen: "list" })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <TeamDetailScreen token={token} teamId={view.teamId} onBack={() => setView({ screen: "list" })} />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка команд…" />;
  }

  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить команды" description={state.message} onRetry={load} />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Команды</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          <Icon name="plus" size={16} />
          Создать
        </button>
      </div>

      {state.teams.length === 0 ? (
        <StateScreen
          kind="empty"
          title="Пока нет команд"
          description="Создайте свою первую команду, чтобы начать."
        />
      ) : (
        state.teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className={styles.teamCard}
            onClick={() => setView({ screen: "detail", teamId: team.id })}
          >
            <div className={styles.teamCardRow}>
              <div className={styles.teamAvatar}>
                {team.logoFileId ? (
                  <AuthenticatedImage
                    token={token}
                    fileId={team.logoFileId}
                    alt=""
                    className={styles.teamAvatarImg}
                  />
                ) : (
                  team.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className={styles.teamNameCol}>
                <div className={styles.teamCardTop}>
                  <h2 className={styles.teamName}>{team.name}</h2>
                  {team.status === "without_coach" && <span className={`${styles.badge} ${styles.badgeWarning}`}>Без тренера</span>}
                  <span className={styles.chevron} aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                </div>
                <p className={styles.teamMeta}>
                  {team.sport}
                  {team.ageCategory ? ` · ${team.ageCategory}` : ""} · {team.membersCount} чел.
                </p>
              </div>
            </div>
            {team.myRole && <span className={styles.badge}>{TEAM_ROLE_LABELS[team.myRole]}</span>}
          </button>
        ))
      )}
    </div>
  );
}
