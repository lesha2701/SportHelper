import { useCallback, useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { useHeadingAction, useHeadingActionVisible } from "../../hooks/useHeadingAction";
import { useIsDesktop } from "../../hooks/useIsDesktop";
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

export function TeamsScreen({ token, createRequest }: { token: string; createRequest?: number }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<View>({ screen: "list" });
  useHeadingAction(createRequest, () => setView({ screen: "create" }));
  useHeadingActionVisible(view.screen === "list");
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
        <h1 className={`${styles.heading} ${styles.headingDup}`}>Команды</h1>
        {!isDesktop && (
          <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
            <Icon name="plus" size={16} />
            Создать
          </button>
        )}
      </div>

      {state.teams.length === 0 ? (
        <StateScreen
          kind="empty"
          title="Пока нет команд"
          description="Создайте свою первую команду, чтобы начать."
        />
      ) : (
        <div className={`${styles.cardGrid} ${state.teams.length === 1 ? styles.cardGridSolo : state.teams.length === 2 ? styles.cardGridPair : ""}`}>
          {state.teams.map((team) => (
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
                {team.myRole && <span className={`${styles.badge} ${styles.roleBadge}`}>{TEAM_ROLE_LABELS[team.myRole]}</span>}
              </div>
              <div className={styles.teamNameCol}>
                <div className={styles.teamCardTop}>
                  <h2 className={styles.teamName}>{team.name}</h2>
                  {team.status === "without_coach" && <span className={`${styles.badge} ${styles.badgeWarning}`}>Без тренера</span>}
                </div>
                <p className={styles.teamMeta}>
                  {team.sport}
                  {team.ageCategory ? ` · ${team.ageCategory}` : ""} · {team.membersCount} чел.
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
