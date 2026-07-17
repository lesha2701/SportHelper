import { useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { TEAM_ROLE_LABELS, type Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import teamStyles from "./teams.module.css";

export function MyTeamsSection({ token, onOpenTeam }: { token: string; onOpenTeam: (teamId: string) => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyTeams(token)
      .then(setTeams)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить команды"));
  }, [token]);

  if (teams === null) {
    return null;
  }

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Мои команды</h2>
      {error && <p className={profileStyles.error}>{error}</p>}
      {teams.length === 0 && (
        <p className={profileStyles.subtitle}>
          Вы пока не состоите ни в одной команде. Попросите тренера прислать ссылку-приглашение.
        </p>
      )}
      {teams.map((team) => (
        <button key={team.id} type="button" className={teamStyles.teamCard} onClick={() => onOpenTeam(team.id)}>
          <div className={teamStyles.teamCardTop}>
            <h3 className={teamStyles.teamName}>{team.name}</h3>
            {team.status === "without_coach" && (
              <span className={`${teamStyles.badge} ${teamStyles.badgeWarning}`}>Без тренера</span>
            )}
            <span className={teamStyles.chevron} aria-hidden="true">
              ›
            </span>
          </div>
          <p className={teamStyles.teamMeta}>
            {team.sport} · {team.myRole && TEAM_ROLE_LABELS[team.myRole]}
          </p>
        </button>
      ))}
    </div>
  );
}
