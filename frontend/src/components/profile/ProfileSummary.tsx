import { useEffect, useState } from "react";
import { listCoachPendingBookings } from "../../api/bookings";
import { getPlayerStats } from "../../api/stats";
import { ApiError } from "../../api/client";
import { removeUserAvatar, uploadUserAvatar } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import { navigate } from "../../router";
import { navigateApp } from "../../appNav";
import { useFinanceFeatures } from "../../features";
import { AchievementsGallery } from "./AchievementsGallery";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { Icon, type IconName } from "../shared/Icon";
import { SKILL_LEVEL_LABELS, type ActiveMode, type ProfileMe } from "../../types/profile";
import { formatRate } from "../../types/stats";
import styles from "./profile.module.css";
import { pluralize, years } from "../../lib/plural";

interface ProfileSummaryProps {
  token: string;
  profile: ProfileMe;
  onEdit: (mode: ActiveMode) => void;
  /** Only administrators may work in both roles; everyone else keeps the role chosen at registration. */
  canSwitchRole: boolean;
  onSwitchMode: (mode: ActiveMode) => void;
  onCreateOther: (mode: ActiveMode) => void;
  onOpenMyStats: () => void;
  onOpenHelp: () => void;
  onOpenSupport: () => void;
  onOpenSettings: () => void;
  onOpenMarketplaceSettings: () => void;
  onOpenMyBookings: () => void;
  onOpenCoachBookings: () => void;
  onOpenIncomingBookings: () => void;
  onOpenNotifications: () => void;
  unreadNotifications?: number;
}

const RING_RADIUS = 56;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface Fact {
  k: string;
  v: string;
}

interface ActionRowDef {
  key: string;
  icon: IconName;
  label: string;
  value?: string;
  badge?: number;
  toggle?: { on: boolean; onChange: () => void };
  onClick?: () => void;
}

/** One card of menu rows, built like the «Профиль тренера» card on the left: a title, a rule, then the rows. */
function ActionCard({ title, rows }: { title?: string; rows: ActionRowDef[] }) {
  return (
    <div className={styles.actionCard}>
      {title && (
        <div className={styles.actionCardHead}>
          <h2 className={styles.factsCardTitle}>{title}</h2>
        </div>
      )}
      <div className={styles.actionCardRows}>
        {rows.map((def) => (
          <ActionRow key={def.key} def={def} />
        ))}
      </div>
    </div>
  );
}

function ActionRow({ def }: { def: ActionRowDef }) {
  return (
    <button type="button" className={styles.actionRow} onClick={def.onClick} disabled={!def.onClick && !def.toggle}>
      <span className={styles.actionRowIcon}>
        <Icon name={def.icon} size={18} />
      </span>
      <span className={styles.actionRowLabel}>{def.label}</span>
      {def.value && <span className={styles.actionRowValue}>{def.value}</span>}
      {!!def.badge && <span className={styles.actionRowBadge}>{def.badge}</span>}
      {def.toggle && (
        <span
          role="switch"
          aria-checked={def.toggle.on}
          className={def.toggle.on ? `${styles.switch} ${styles.switchOn}` : styles.switch}
          onClick={(e) => {
            e.stopPropagation();
            def.toggle!.onChange();
          }}
        >
          <span className={styles.switchKnob} />
        </span>
      )}
      {!def.toggle && (
        <span className={styles.actionRowChevron}>
          <Icon name="chevron-right" size={16} />
        </span>
      )}
    </button>
  );
}

export function ProfileSummary({
  token,
  profile,
  onEdit,
  canSwitchRole,
  onSwitchMode,
  onCreateOther,
  onOpenMyStats,
  onOpenHelp,
  onOpenSupport,
  onOpenSettings,
  onOpenMarketplaceSettings,
  onOpenMyBookings,
  onOpenCoachBookings,
  onOpenIncomingBookings,
  onOpenNotifications,
  unreadNotifications,
}: ProfileSummaryProps) {
  const { state: authState, updateUser, logout } = useAuth();
  const { trainerBalance } = useFinanceFeatures();
  const photoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const avatarFileId = authState.status === "ready" ? authState.user.avatarFileId : null;
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const mode: ActiveMode = profile.activeMode ?? (profile.player ? "player" : "coach");

  const [pendingCount, setPendingCount] = useState(0);
  const [attendanceRate, setAttendanceRate] = useState<number | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarChange = async (file: File) => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const updated = await uploadUserAvatar(token, file);
      updateUser(updated);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const updated = await removeUserAvatar(token);
      updateUser(updated);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : "Не удалось удалить фото");
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    if (mode !== "coach") return;
    listCoachPendingBookings(token)
      .then((bookings) => setPendingCount(bookings.length))
      .catch(() => setPendingCount(0));
  }, [token, mode]);

  useEffect(() => {
    if (mode !== "player" || !myUserId) return;
    getPlayerStats(token, myUserId)
      .then((stats) => setAttendanceRate(stats.attendanceRate))
      .catch(() => setAttendanceRate(null));
  }, [token, mode, myUserId]);

  const fullName = mode === "player" ? profile.player?.fullName : profile.coach?.fullName;
  const initial = (fullName ?? "?").trim().charAt(0).toUpperCase() || "?";

  const heroStats: { value: string; label: string }[] =
    mode === "player" && profile.player
      ? [
          profile.player.age !== null && { value: String(profile.player.age), label: pluralize(profile.player.age, "год", "года", "лет") },
          profile.player.heightCm !== null && { value: String(profile.player.heightCm), label: "см" },
          profile.player.weightKg !== null && { value: String(profile.player.weightKg), label: "кг" },
        ].filter((x): x is { value: string; label: string } => !!x)
      : mode === "coach" && profile.coach && profile.coach.experienceYears !== null
        ? [{ value: String(profile.coach.experienceYears), label: `${pluralize(profile.coach.experienceYears, "год", "года", "лет")} опыта` }]
        : [];

  const goalText = mode === "player" ? profile.player?.goals : profile.coach?.description;
  const goalLabel = mode === "player" ? "Цель сезона" : "О себе";

  const facts: Fact[] =
    mode === "player" && profile.player
      ? [
          { k: "Вид спорта", v: profile.player.sport },
          ...(profile.player.position ? [{ k: "Позиция", v: profile.player.position }] : []),
          ...(profile.player.level ? [{ k: "Уровень", v: SKILL_LEVEL_LABELS[profile.player.level] }] : []),
        ]
      : mode === "coach" && profile.coach
        ? [
            { k: "Вид спорта", v: profile.coach.sport },
            ...(profile.coach.specialization ? [{ k: "Специализация", v: profile.coach.specialization }] : []),
            ...(profile.coach.experienceYears !== null ? [{ k: "Опыт", v: years(profile.coach.experienceYears) }] : []),
          ]
        : [];

  // A coach's offers to the players are a block of their own, right after «О тренере»: their listings, the requests and bookings
  // that come from them, the money, the catalogue.
  const offerRows: ActionRowDef[] = [];
  if (mode === "coach" && profile.coach) {
    offerRows.push({ key: "listings", icon: "settings", label: "Мои объявления", onClick: onOpenMarketplaceSettings });
    offerRows.push({ key: "incoming", icon: "inbox", label: "Входящие заявки", badge: pendingCount, onClick: onOpenIncomingBookings });
    offerRows.push({ key: "records", icon: "calendar", label: "Записи", onClick: onOpenCoachBookings });
    if (trainerBalance) {
      offerRows.push({ key: "finance", icon: "wallet", label: "Финансы", onClick: () => navigateApp({ kind: "finance" }) });
    }
    offerRows.push({
      key: "catalogue",
      icon: "users",
      label: "Каталог тренеров",
      onClick: () => navigateApp({ kind: "tab", tab: "coaches" }),
    });
  }

  const actionRows: ActionRowDef[] = [];
  actionRows.push({ key: "stats", icon: "award", label: "Моя статистика", onClick: onOpenMyStats });
  if (mode !== "coach") actionRows.push({ key: "bookings", icon: "calendar", label: "Мои брони", onClick: onOpenMyBookings });
  actionRows.push({
    key: "notifications",
    icon: "bell",
    label: "Уведомления",
    badge: unreadNotifications,
    onClick: onOpenNotifications,
  });
  if (authState.status === "ready" && authState.user.isAdmin) {
    // Shown only when the server says this account is an administrator; the server re-checks every admin request.
    actionRows.push({ key: "admin", icon: "shield", label: "Админ-панель", onClick: () => navigate("/admin") });
  }
  actionRows.push({ key: "settings", icon: "settings", label: "Настройки", onClick: onOpenSettings });
  actionRows.push({ key: "help", icon: "book", label: "Помощь", onClick: onOpenHelp });
  actionRows.push({ key: "support", icon: "message", label: "Поддержка", onClick: onOpenSupport });
  actionRows.push({ key: "logout", icon: "log-out", label: "Выйти из аккаунта", onClick: () => void logout() });
  // The role is fixed at registration: only administrators get a switch or a second profile.
  if (canSwitchRole) {
    if (profile.player && profile.coach) {
      // «Переключиться на …» is a button in the page header
    } else if (!profile.player) {
      actionRows.push({ key: "create-player", icon: "plus", label: "Завести профиль игрока", onClick: () => onCreateOther("player") });
    } else if (!profile.coach) {
      actionRows.push({ key: "create-coach", icon: "plus", label: "Завести профиль тренера", onClick: () => onCreateOther("coach") });
    }
  }

  const canToggleRole = canSwitchRole && !!profile.player && !!profile.coach;
  const switchLabel = `Переключиться на ${mode === "player" ? "тренера" : "игрока"}`;

  return (
    <div className={styles.summaryScreen}>
      <div className={styles.summaryHeader}>
        <div className={styles.heroRingWrap}>
          {mode === "player" && (
            <svg viewBox="0 0 120 120" className={styles.heroRingSvg}>
              <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="var(--color-border-strong)" strokeWidth="5" />
              <circle
                cx="60"
                cy="60"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - (attendanceRate ?? 0))}
              />
            </svg>
          )}
          <div className={styles.heroRingAvatar}>
            {avatarFileId ? (
              <AuthenticatedImage token={token} fileId={avatarFileId} alt="" className={styles.heroRingAvatarImg} zoomable />
            ) : photoUrl ? (
              <img className={styles.heroRingAvatarImg} src={photoUrl} alt="" />
            ) : (
              initial
            )}
          </div>
          <label className={styles.avatarEditButton} title="Изменить фото профиля">
            <Icon name="edit" size={14} />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className={styles.avatarEditInput}
              disabled={avatarBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleAvatarChange(file);
              }}
            />
          </label>
        </div>

        <div className={styles.summaryHeadText}>
          <h1 className={styles.heroName}>{fullName ?? "—"}</h1>
          <p className={styles.heroSub}>
            {mode === "player"
              ? [profile.player?.position, profile.player?.sport].filter(Boolean).join(" · ")
              : [profile.coach?.specialization, profile.coach?.sport].filter(Boolean).join(" · ")}
          </p>
          {mode === "player" && attendanceRate !== null && <p className={styles.heroSub}>Посещаемость: {formatRate(attendanceRate)}</p>}
          {avatarFileId && (
            <button type="button" className={styles.linkAction} onClick={() => void handleAvatarRemove()} disabled={avatarBusy}>
              Удалить фото
            </button>
          )}
          {avatarError && (
            <p className={styles.heroSub} style={{ color: "var(--color-danger-text)" }}>
              {avatarError}
            </p>
          )}
        </div>

        <div className={styles.summaryHeadActions}>
          {canToggleRole && (
            <button type="button" className={styles.buttonSecondary} onClick={() => onSwitchMode(mode === "player" ? "coach" : "player")}>
              {switchLabel}
            </button>
          )}
          <button type="button" className={styles.buttonPrimary} onClick={() => onEdit(mode)}>
            Редактировать
          </button>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryMain}>
          {(heroStats.length > 0 || facts.length > 0) && (
            <div className={styles.factsCard}>
              <div className={styles.factsCardHead}>
                <h2 className={styles.factsCardTitle}>{mode === "player" ? "Профиль игрока" : "Профиль тренера"}</h2>
              </div>
              {heroStats.length > 0 && (
                <div className={styles.heroStatsRow} style={{ gridTemplateColumns: `repeat(${heroStats.length}, minmax(0, 1fr))` }}>
                  {heroStats.map((st) => (
                    <div key={st.label} className={styles.heroStat}>
                      <span className={styles.heroStatValue}>{st.value}</span>
                      <span className={styles.heroStatLabel}>{st.label}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.factsGrid}>
                {facts.map((f) => (
                  <div key={f.k} className={styles.factTile}>
                    <span className={styles.factTileLabel}>{f.k}</span>
                    <span className={styles.factTileValue}>{f.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {goalText && (
            <div className={styles.goalCard}>
              <span className={styles.goalCardLabel}>{goalLabel}</span>
              <p className={styles.goalCardText}>{goalText}</p>
            </div>
          )}

          {myUserId && <AchievementsGallery token={token} userId={myUserId} editable />}
        </div>

        <div className={styles.summarySide}>
          {offerRows.length > 0 && <ActionCard title="Объявления" rows={offerRows} />}
          <ActionCard title={offerRows.length > 0 ? "Тренировки" : undefined} rows={actionRows} />
        </div>
      </div>
    </div>
  );
}
