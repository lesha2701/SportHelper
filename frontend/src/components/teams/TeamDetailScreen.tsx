import { useCallback, useEffect, useState } from "react";
import { getTeam, leaveTeam, listMembers } from "../../api/teams";
import { getTeamStats } from "../../api/stats";
import { listTeamMatches } from "../../api/matches";
import { listTeamTrainings } from "../../api/trainings";
import { getTeamSummary } from "../../api/ai";
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
import { StatTile } from "../shared/StatTile";
import { TeamTrainingsTab } from "../trainings/TeamTrainingsTab";
import { TeamTasksTab } from "../tasks/TeamTasksTab";
import { TeamMatchesTab } from "../matches/TeamMatchesTab";
import { TeamStatsTab } from "../stats/TeamStatsTab";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import { TEAM_ROLE_LABELS, type Team, type TeamMember } from "../../types/team";
import { formatRate, type TeamStats } from "../../types/stats";
import type { Match } from "../../types/match";
import type { Training } from "../../types/training";
import profileStyles from "../profile/profile.module.css";
import aiStyles from "../stats/stats.module.css";
import styles from "./teams.module.css";

type Tab = "roster" | "trainings" | "tasks" | "matches" | "stats" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  roster: "Состав",
  trainings: "Тренировки",
  tasks: "Задания",
  matches: "Матчи",
  stats: "Статистика",
  settings: "Настройки",
};

const WAVE_PATH = "M-20 90 C 60 40, 140 140, 220 60 S 380 20, 440 70";

function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; team: Team; members: TeamMember[] };

export function TeamDetailScreen({ token, teamId, onBack }: { token: string; teamId: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("roster");
  const [editing, setEditing] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [viewingProfileOf, setViewingProfileOf] = useState<TeamMember | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const [stats, setStats] = useState<TeamStats | null>(null);
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [nextTraining, setNextTraining] = useState<Training | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

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

  useEffect(() => {
    getTeamStats(token, teamId)
      .then(setStats)
      .catch(() => setStats(null));
    listTeamMatches(token, teamId)
      .then((matches) =>
        setRecentMatches(
          matches
            .filter((m) => m.status === "completed" && m.result !== null)
            .sort((a, b) => (a.matchDate < b.matchDate ? -1 : 1)),
        ),
      )
      .catch(() => setRecentMatches([]));
    listTeamTrainings(token, teamId)
      .then((trainings) => {
        const today = todayIso();
        const upcoming = trainings
          .filter((t) => t.status === "scheduled" && t.trainingDate >= today)
          .sort((a, b) => (a.trainingDate === b.trainingDate ? a.startTime.localeCompare(b.startTime) : a.trainingDate.localeCompare(b.trainingDate)));
        setNextTraining(upcoming[0] ?? null);
      })
      .catch(() => setNextTraining(null));
  }, [token, teamId]);

  const handleAiSummary = async () => {
    setAiError(null);
    setAiLoading(true);
    try {
      setAiSummary(await getTeamSummary(token, teamId));
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "Не удалось получить сводку");
    } finally {
      setAiLoading(false);
    }
  };

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

  const form = recentMatches.slice(-5).map((m) => (m.result === "win" ? "В" : m.result === "loss" ? "П" : "Н"));
  const visibleTabs = (Object.keys(TAB_LABELS) as Tab[]).filter((t) => {
    if (t === "stats") return isCoachStaff;
    if (t === "settings") return canSeeSettingsTab;
    return true;
  });

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={styles.teamHero}>
        <svg viewBox="0 0 400 120" preserveAspectRatio="none" className={styles.teamHeroWave}>
          <path d={WAVE_PATH} stroke="#ff3b3f" strokeWidth="26" fill="none" strokeLinecap="round" />
        </svg>
        <div className={styles.teamHeroLogo}>
          {team.logoFileId ? (
            <AuthenticatedImage token={token} fileId={team.logoFileId} alt="" className={styles.teamHeroLogoImg} />
          ) : (
            team.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className={styles.teamHeroInfo}>
          <h1 className={styles.teamHeroName}>{team.name}</h1>
          <span className={styles.teamHeroMeta}>
            {[
              team.sport,
              team.ageCategory,
              team.level ? SKILL_LEVEL_LABELS[team.level] : null,
              `${team.membersCount} игроков`,
              myRole ? TEAM_ROLE_LABELS[myRole] : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {stats && (
          <div className={styles.teamHeroStats}>
            <div className={styles.teamHeroStat}>
              <span className={styles.teamHeroStatValue} style={{ color: "var(--color-success)" }}>
                {stats.matchesWon}
              </span>
              <span className={styles.teamHeroStatLabel}>Победы</span>
            </div>
            <div className={styles.teamHeroStat}>
              <span className={styles.teamHeroStatValue}>{stats.matchesDrawn}</span>
              <span className={styles.teamHeroStatLabel}>Ничьи</span>
            </div>
            <div className={styles.teamHeroStat}>
              <span className={styles.teamHeroStatValue} style={{ color: "var(--color-danger)" }}>
                {stats.matchesLost}
              </span>
              <span className={styles.teamHeroStatLabel}>Поражения</span>
            </div>
            {form.length > 0 && (
              <div className={styles.teamHeroForm}>
                <span className={styles.teamHeroStatLabel}>Форма</span>
                <div className={styles.teamHeroFormRow}>
                  {form.map((r, i) => (
                    <span
                      key={i}
                      className={styles.teamHeroFormBadge}
                      style={{
                        background: r === "В" ? "var(--color-success)" : r === "П" ? "var(--color-danger)" : "var(--color-text-tertiary)",
                      }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.realTabBar}>
        {visibleTabs.map((t) => (
          <button key={t} type="button" className={tab === t ? styles.realTabActive : styles.realTab} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <div className={styles.teamContentLayout}>
          <div className={styles.cardGrid}>
            {members.map((member) => (
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
                  {member.position && <span className={styles.memberMeta}>{member.position}</span>}
                  <span className={styles.memberRolePill}>{TEAM_ROLE_LABELS[member.role]}</span>
                </div>
              </button>
            ))}
          </div>

          <div className={styles.teamSidebar}>
            <div className={styles.nextTrainingCard}>
              <span className={styles.nextTrainingLabel}>Следующая тренировка</span>
              {nextTraining ? (
                <>
                  <h3 className={styles.nextTrainingTitle}>{nextTraining.description || "Тренировка"}</h3>
                  <span className={styles.nextTrainingMeta}>
                    {parseIsoDateLocal(nextTraining.trainingDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })}
                    {" · "}
                    {nextTraining.startTime.slice(0, 5)}
                    {nextTraining.location ? ` · ${nextTraining.location}` : ""}
                  </span>
                </>
              ) : (
                <p className={profileStyles.subtitle} style={{ margin: 0 }}>
                  Пока не запланирована.
                </p>
              )}
            </div>

            {stats && (
              <div className={styles.quickStatsGrid}>
                <StatTile value={formatRate(stats.attendanceRate)} label="Посещаемость" tone="dark" />
                <StatTile value={stats.avgDifficulty ?? "—"} label="Сложность" />
                <StatTile value={stats.trainingsCompleted} label="Тренировок" />
                <StatTile value={stats.tasksOverdue} label="Просрочено" />
              </div>
            )}

            <div className={aiStyles.aiCard}>
              <div className={aiStyles.aiCardHead}>
                <Icon name="sparkles" size={18} />
                <span className={aiStyles.aiCardTitle}>Сводка ИИ</span>
              </div>
              {!aiSummary && (
                <p className={profileStyles.subtitle} style={{ margin: 0 }}>
                  Краткая сводка по команде и предупреждение о перегрузке.
                </p>
              )}
              {aiSummary && (
                <p className={profileStyles.subtitle} style={{ margin: 0 }}>
                  {aiSummary}
                </p>
              )}
              {aiError && <p className={profileStyles.error}>{aiError}</p>}
              <button
                type="button"
                className={profileStyles.buttonPrimary}
                onClick={() => void handleAiSummary()}
                disabled={aiLoading}
                style={{ marginTop: "auto" }}
              >
                {aiLoading ? "Формирую…" : aiSummary ? "Обновить сводку" : "Сформировать сводку"}
              </button>
            </div>
          </div>
        </div>
      )}

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
