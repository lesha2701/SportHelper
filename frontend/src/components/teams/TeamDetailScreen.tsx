import { useCallback, useEffect, useState } from "react";
import { getTeam, leaveTeam, listMembers } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { CreateTeamForm } from "./CreateTeamForm";
import { InviteSection } from "./InviteSection";
import { ApplicationsSection } from "./ApplicationsSection";
import { LogoSection } from "./LogoSection";
import { MemberActionsModal } from "./MemberActionsModal";
import { TransferOwnershipModal } from "./TransferOwnershipModal";
import { PlayerProfileView } from "./PlayerProfileView";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { Icon } from "../shared/Icon";
import { TeamTrainingsTab } from "../trainings/TeamTrainingsTab";
import { TeamTasksTab } from "../tasks/TeamTasksTab";
import { TeamMatchesTab } from "../matches/TeamMatchesTab";
import { TeamStatsTab } from "../stats/TeamStatsTab";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import { TEAM_ROLE_LABELS, type Team, type TeamMember } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";

type Tab = "overview" | "roster" | "trainings" | "tasks" | "matches" | "stats" | "settings";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; team: Team; members: TeamMember[] };

export function TeamDetailScreen({ token, teamId, onBack }: { token: string; teamId: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [viewingProfileOf, setViewingProfileOf] = useState<TeamMember | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([getTeam(token, teamId), listMembers(token, teamId)])
      .then(([team, members]) => setState({ status: "ready", team, members }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить команду";
        setState({ status: "error", message });
      });
  }, [token, teamId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка команды…" />;
  }

  if (state.status === "error") {
    return (
      <StateScreen kind="error" title="Не удалось загрузить команду" description={state.message} onRetry={load} />
    );
  }

  const { team, members } = state;
  const myRole = team.myRole;
  const isHeadCoach = myRole === "head_coach";
  const isCoachStaff = myRole === "head_coach" || myRole === "assistant_coach";
  const isCaptain = myRole === "captain";
  const canSeeSettingsTab = isCoachStaff || (isCaptain && team.status === "without_coach");

  if (editing) {
    return (
      <CreateTeamForm
        token={token}
        initial={team}
        onCreated={() => {
          setEditing(false);
          load();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (viewingProfileOf) {
    return (
      <PlayerProfileView
        token={token}
        teamId={teamId}
        userId={viewingProfileOf.userId}
        displayName={`${viewingProfileOf.firstName} ${viewingProfileOf.lastName ?? ""}`.trim()}
        onBack={() => setViewingProfileOf(null)}
      />
    );
  }

  const handleLeave = async () => {
    setLeaveBusy(true);
    setLeaveError(null);
    try {
      await leaveTeam(token, teamId);
      onBack();
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : "Не удалось выйти из команды");
      setLeaveBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => (tab === "overview" ? onBack() : setTab("overview"))}
        >
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      {tab === "overview" && (
        <>
          <div className={profileStyles.card}>
            {team.logoFileId && (
              <AuthenticatedImage
                token={token}
                fileId={team.logoFileId}
                alt={`Логотип команды ${team.name}`}
                className={styles.teamLogo}
              />
            )}
            <div className={styles.teamCardTop}>
              <h1 className={profileStyles.title}>{team.name}</h1>
              {team.status === "without_coach" && <span className={`${styles.badge} ${styles.badgeWarning}`}>Без тренера</span>}
            </div>
            {team.description && <p className={profileStyles.subtitle}>{team.description}</p>}

            <div className={styles.statGrid}>
              <div className={styles.statTile}>
                <span className={styles.statValue}>{team.membersCount}</span>
                <span className={styles.statLabel}>Участников</span>
              </div>
              <div className={styles.statTile}>
                <span className={styles.statValue}>{myRole ? TEAM_ROLE_LABELS[myRole] : "—"}</span>
                <span className={styles.statLabel}>Ваша роль</span>
              </div>
            </div>

            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Вид спорта</span>
              <span className={profileStyles.rowValue}>{team.sport}</span>
            </div>
            {team.ageCategory && (
              <div className={profileStyles.row}>
                <span className={profileStyles.rowLabel}>Возрастная категория</span>
                <span className={profileStyles.rowValue}>{team.ageCategory}</span>
              </div>
            )}
            {team.level && (
              <div className={profileStyles.row}>
                <span className={profileStyles.rowLabel}>Уровень</span>
                <span className={profileStyles.rowValue}>{SKILL_LEVEL_LABELS[team.level]}</span>
              </div>
            )}
          </div>

          <div className={styles.hubGrid}>
            <button type="button" className={styles.hubTile} onClick={() => setTab("roster")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="users" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Состав</span>
              <span className={styles.hubTileSubtitle}>{members.length} участников</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("trainings")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="dumbbell" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Тренировки</span>
              <span className={styles.hubTileSubtitle}>Расписание команды</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("tasks")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="clipboard" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Задания</span>
              <span className={styles.hubTileSubtitle}>Задания игрокам</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("matches")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="ball" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Матчи</span>
              <span className={styles.hubTileSubtitle}>Составы и результаты</span>
            </button>

            {isCoachStaff && (
              <button type="button" className={styles.hubTile} onClick={() => setTab("stats")}>
                <div className={styles.hubTileTop}>
                  <span className={styles.hubTileIcon}>
                    <Icon name="award" size={20} />
                  </span>
                  <span className={styles.chevron}>
                    <Icon name="chevron-right" size={16} />
                  </span>
                </div>
                <span className={styles.hubTileTitle}>Статистика</span>
                <span className={styles.hubTileSubtitle}>Показатели команды</span>
              </button>
            )}

            {canSeeSettingsTab && (
              <button type="button" className={styles.hubTile} onClick={() => setTab("settings")}>
                <div className={styles.hubTileTop}>
                  <span className={styles.hubTileIcon}>
                    <Icon name="settings" size={20} />
                  </span>
                  <span className={styles.chevron}>
                    <Icon name="chevron-right" size={16} />
                  </span>
                </div>
                <span className={styles.hubTileTitle}>Настройки</span>
                <span className={styles.hubTileSubtitle}>Лого, приглашения, заявки</span>
              </button>
            )}
          </div>

          <div className={profileStyles.card}>
            {isHeadCoach && (
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setTransferOpen(true)}>
                Передать роль основного тренера
              </button>
            )}
            {leaveError && <p className={profileStyles.error}>{leaveError}</p>}
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setLeaveConfirmOpen(true)}>
              Покинуть команду
            </button>
          </div>
        </>
      )}

      {tab === "roster" &&
        members.map((member) => (
          <button
            key={member.userId}
            type="button"
            className={styles.memberRow}
            onClick={() => (isCoachStaff ? setSelectedMember(member) : undefined)}
            style={{ cursor: isCoachStaff ? "pointer" : "default", textAlign: "left" }}
          >
            {member.photoUrl ? (
              <img className={styles.avatar} src={member.photoUrl} alt="" />
            ) : (
              <div className={styles.avatar} />
            )}
            <div className={styles.memberInfo}>
              <span className={styles.memberName}>
                {member.firstName} {member.lastName ?? ""}
              </span>
              <span className={styles.memberMeta}>
                {TEAM_ROLE_LABELS[member.role]}
                {member.position ? ` · ${member.position}` : ""}
              </span>
            </div>
          </button>
        ))}

      {tab === "trainings" && <TeamTrainingsTab token={token} teamId={teamId} canManage={isCoachStaff} />}

      {tab === "tasks" && <TeamTasksTab token={token} teamId={teamId} canManage={isCoachStaff} />}

      {tab === "matches" && <TeamMatchesTab token={token} teamId={teamId} canManage={isCoachStaff} />}

      {tab === "stats" && isCoachStaff && <TeamStatsTab token={token} teamId={teamId} />}

      {tab === "settings" && (
        <>
          {isCoachStaff && (
            <div className={profileStyles.card}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => setEditing(true)}>
                Редактировать команду
              </button>
            </div>
          )}
          {isCoachStaff && <LogoSection token={token} teamId={teamId} onUploaded={load} />}
          {isCoachStaff && <InviteSection token={token} teamId={teamId} kind="join" title="Пригласить игроков" />}
          {isCaptain && team.status === "without_coach" && (
            <InviteSection token={token} teamId={teamId} kind="head_coach" title="Пригласить нового тренера" />
          )}
          {isCoachStaff && <ApplicationsSection token={token} teamId={teamId} onChanged={load} />}
        </>
      )}

      {selectedMember && myRole && (
        <MemberActionsModal
          token={token}
          teamId={teamId}
          member={selectedMember}
          actorRole={myRole}
          onClose={() => setSelectedMember(null)}
          onChanged={() => {
            setSelectedMember(null);
            load();
          }}
          onViewProfile={() => {
            setViewingProfileOf(selectedMember);
            setSelectedMember(null);
          }}
        />
      )}

      {transferOpen && (
        <TransferOwnershipModal
          token={token}
          teamId={teamId}
          teamName={team.name}
          candidates={members.filter((m) => m.role !== "head_coach")}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            setTransferOpen(false);
            load();
          }}
        />
      )}

      {leaveConfirmOpen && (
        <ConfirmModal
          title="Покинуть команду?"
          description={
            isHeadCoach
              ? "Вы основной тренер — после выхода команда останется без тренера, пока капитан не пригласит нового."
              : undefined
          }
          danger
          busy={leaveBusy}
          confirmLabel="Покинуть"
          onConfirm={handleLeave}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      )}
    </div>
  );
}
