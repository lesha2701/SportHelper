import { useEffect, useState } from "react";
import { listCoachPendingBookings } from "../../api/bookings";
import { getPlayerStats } from "../../api/stats";
import { useAuth } from "../../context/AuthContext";
import { Icon, type IconName } from "../shared/Icon";
import { SKILL_LEVEL_LABELS, type ActiveMode, type ProfileMe } from "../../types/profile";
import { formatRate } from "../../types/stats";
import styles from "./profile.module.css";

interface ProfileSummaryProps {
  token: string;
  profile: ProfileMe;
  onEdit: (mode: ActiveMode) => void;
  onSwitchMode: (mode: ActiveMode) => void;
  onCreateOther: (mode: ActiveMode) => void;
  onOpenMyStats: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenMarketplaceSettings: () => void;
  onOpenMyBookings: () => void;
  onOpenCoachBookings: () => void;
  onOpenIncomingBookings: () => void;
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
  onSwitchMode,
  onCreateOther,
  onOpenMyStats,
  onOpenHelp,
  onOpenSettings,
  onOpenMarketplaceSettings,
  onOpenMyBookings,
  onOpenCoachBookings,
  onOpenIncomingBookings,
}: ProfileSummaryProps) {
  const { state: authState } = useAuth();
  const photoUrl = authState.status === "ready" ? authState.user.photoUrl : null;
  const myUserId = authState.status === "ready" ? authState.user.id : null;
  const mode: ActiveMode = profile.activeMode ?? (profile.player ? "player" : "coach");

  const [pendingCount, setPendingCount] = useState(0);
  const [attendanceRate, setAttendanceRate] = useState<number | null>(null);

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
          profile.player.age !== null && { value: String(profile.player.age), label: "лет" },
          profile.player.heightCm !== null && { value: String(profile.player.heightCm), label: "см" },
          profile.player.weightKg !== null && { value: String(profile.player.weightKg), label: "кг" },
        ].filter((x): x is { value: string; label: string } => !!x)
      : mode === "coach" && profile.coach && profile.coach.experienceYears !== null
        ? [{ value: String(profile.coach.experienceYears), label: "лет опыта" }]
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
            ...(profile.coach.experienceYears !== null ? [{ k: "Опыт", v: `${profile.coach.experienceYears} лет` }] : []),
          ]
        : [];

  const actionRows: ActionRowDef[] = [];
  if (mode === "coach" && profile.coach) {
    actionRows.push({ key: "listings", icon: "settings", label: "Мои объявления", onClick: onOpenMarketplaceSettings });
    actionRows.push({
      key: "incoming",
      icon: "inbox",
      label: "Входящие заявки",
      badge: pendingCount,
      onClick: onOpenIncomingBookings,
    });
  }
  actionRows.push({ key: "stats", icon: "award", label: "Моя статистика", onClick: onOpenMyStats });
  actionRows.push(
    mode === "coach"
      ? { key: "records", icon: "calendar", label: "Записи", onClick: onOpenCoachBookings }
      : { key: "bookings", icon: "calendar", label: "Мои брони", onClick: onOpenMyBookings },
  );
  actionRows.push({ key: "settings", icon: "settings", label: "Настройки", onClick: onOpenSettings });
  actionRows.push({ key: "help", icon: "book", label: "Помощь", onClick: onOpenHelp });
  if (profile.player && profile.coach) {
    actionRows.push({
      key: "switch",
      icon: "users",
      label: `Переключиться на ${mode === "player" ? "тренера" : "игрока"}`,
      onClick: () => onSwitchMode(mode === "player" ? "coach" : "player"),
    });
  } else if (!profile.player) {
    actionRows.push({ key: "create-player", icon: "plus", label: "Завести профиль игрока", onClick: () => onCreateOther("player") });
  } else if (!profile.coach) {
    actionRows.push({ key: "create-coach", icon: "plus", label: "Завести профиль тренера", onClick: () => onCreateOther("coach") });
  }

  return (
    <div className={styles.summaryScreen}>
      <div className={styles.summaryIdentity}>
        <div className={styles.heroIdentity}>
          <div className={styles.heroRingWrap}>
            {mode === "player" && (
              <svg width="120" height="120" viewBox="0 0 120 120" className={styles.heroRingSvg}>
                <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="5" />
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
              {photoUrl ? <img className={styles.heroRingAvatarImg} src={photoUrl} alt="" /> : initial}
            </div>
          </div>
          <div>
            <h1 className={styles.heroName}>{fullName ?? "—"}</h1>
            <p className={styles.heroSub}>
              {mode === "player"
                ? [profile.player?.position, profile.player?.sport].filter(Boolean).join(" · ")
                : [profile.coach?.specialization, profile.coach?.sport].filter(Boolean).join(" · ")}
            </p>
          </div>
          {mode === "player" && attendanceRate !== null && (
            <p className={styles.heroSub} style={{ margin: 0 }}>
              Посещаемость: {formatRate(attendanceRate)}
            </p>
          )}
          {heroStats.length > 0 && (
            <div className={styles.heroStatsRow} style={{ gridTemplateColumns: `repeat(${heroStats.length}, 1fr)` }}>
              {heroStats.map((s) => (
                <div key={s.label} className={styles.heroStat}>
                  <span className={styles.heroStatValue}>{s.value}</span>
                  <span className={styles.heroStatLabel}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {profile.player && profile.coach && (
          <div className={styles.modePill}>
            <button
              type="button"
              className={mode === "player" ? styles.modePillOptionActive : styles.modePillOption}
              onClick={() => mode !== "player" && onSwitchMode("player")}
            >
              Я игрок
            </button>
            <button
              type="button"
              className={mode === "coach" ? styles.modePillOptionActive : styles.modePillOption}
              onClick={() => mode !== "coach" && onSwitchMode("coach")}
            >
              Я тренер
            </button>
          </div>
        )}

        {goalText && (
          <div className={styles.goalCard}>
            <span className={styles.goalCardLabel}>{goalLabel}</span>
            <p className={styles.goalCardText}>{goalText}</p>
          </div>
        )}
      </div>

      <div className={styles.summaryActions}>
        {facts.length > 0 && (
          <div className={styles.factsCard}>
            <div className={styles.factsCardHead}>
              <h2 className={styles.factsCardTitle}>{mode === "player" ? "Профиль игрока" : "Профиль тренера"}</h2>
              <button type="button" className={styles.factsCardEdit} onClick={() => onEdit(mode)}>
                Редактировать
              </button>
            </div>
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

        <div className={styles.actionRowList}>
          {actionRows.map((def) => (
            <ActionRow key={def.key} def={def} />
          ))}
        </div>
      </div>
    </div>
  );
}
