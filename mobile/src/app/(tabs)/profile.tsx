import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { listCoachPendingBookings } from "@/api/bookings";
import { getPlayerStats } from "@/api/stats";
import { removeUserAvatar, uploadUserAvatar } from "@/api/users";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { pickSquareImage } from "@/lib/pickImage";
import { useFeatures } from "@/lib/useFeatures";
import { useLoad } from "@/lib/useLoad";
import { useUnread } from "@/notifications/UnreadProvider";
import { AchievementsGallery } from "@/profile/AchievementsGallery";
import { useProfile } from "@/profile/ProfileProvider";
import { DOCUMENT_LIST } from "@/shared/legal/documents";
import { pluralize, years } from "@/shared/lib/plural";
import { SKILL_LEVEL_LABELS, type ProfileMe } from "@/shared/types/profile";
import { formatRate } from "@/shared/types/stats";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { ListRow } from "@/ui/ListRow";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

type Mode = "player" | "coach";

function currentMode(profile: ProfileMe, preferred: Mode | null): Mode {
  if (profile.activeMode) return profile.activeMode;
  if (profile.player && !profile.coach) return "player";
  if (profile.coach && !profile.player) return "coach";
  return preferred ?? "player";
}

function FactTile({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="label" style={{ fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}

/** The person's page, as on the website: who they are (photo, name, role, email), the numbers and facts of their
 * profile, the places they go often, and the account actions. */
export default function ProfileScreen() {
  const { user, refreshUser, signOut } = useAuth();
  const { state, switchMode } = useProfile();
  const { colors } = useTheme();
  const features = useFeatures();
  const unread = useUnread();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [docs, setDocs] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const mode = state.status === "ready" ? currentMode(state.data, user?.preferredRole ?? null) : "player";

  const extra = useLoad(async () => {
    if (mode === "coach") return { pending: (await listCoachPendingBookings().catch(() => [])).length, attendance: null };
    const stats = await getPlayerStats(user!.id).catch(() => null);
    return { pending: 0, attendance: stats?.attendanceRate ?? null };
  }, [mode, user?.id]);

  if (state.status !== "ready" || !user) return null;
  const { player, coach } = state.data;
  const name = (mode === "player" ? player?.fullName : coach?.fullName) || [user.firstName, user.lastName].filter(Boolean).join(" ");

  async function changePhoto() {
    setPhotoMenu(false);
    const file = await pickSquareImage();
    if (!file) return;
    setBusy(true);
    try {
      await uploadUserAvatar(file);
      await refreshUser();
    } catch (e) {
      toast.error(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoMenu(false);
    setBusy(true);
    try {
      await removeUserAvatar();
      await refreshUser();
    } catch (e) {
      toast.error(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const heroStats =
    mode === "player" && player
      ? [
          player.age !== null ? { value: String(player.age), label: pluralize(player.age, "год", "года", "лет") } : null,
          player.heightCm !== null ? { value: String(player.heightCm), label: "см" } : null,
          player.weightKg !== null ? { value: String(player.weightKg), label: "кг" } : null,
          extra.data?.attendance != null ? { value: formatRate(extra.data.attendance), label: "посещаемость" } : null,
        ].filter((x): x is { value: string; label: string } => x !== null)
      : coach && coach.experienceYears !== null
        ? [{ value: String(coach.experienceYears), label: `${pluralize(coach.experienceYears, "год", "года", "лет")} опыта` }]
        : [];

  const subtitle = mode === "player" ? [player?.position, player?.sport].filter(Boolean).join(" · ") : [coach?.specialization, coach?.sport].filter(Boolean).join(" · ");
  const goal = mode === "player" ? player?.goals : coach?.description;

  const facts =
    mode === "player" && player
      ? [
          { k: "Вид спорта", v: player.sport },
          player.position ? { k: "Позиция", v: player.position } : null,
          player.level ? { k: "Уровень", v: SKILL_LEVEL_LABELS[player.level] } : null,
          player.loadRestrictions ? { k: "Ограничения", v: player.loadRestrictions } : null,
        ]
      : coach
        ? [
            { k: "Вид спорта", v: coach.sport },
            coach.experienceYears !== null ? { k: "Опыт", v: years(coach.experienceYears) } : null,
            coach.specialization ? { k: "Специализация", v: coach.specialization } : null,
          ]
        : [];

  return (
    <Screen
      header
      onRefresh={() => {
        extra.reload();
        void refreshUser();
      }}
      refreshing={extra.loading && !!extra.data}
    >
      {user.isAdmin ? (
        <View style={[styles.switch, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(["player", "coach"] as const).map((m) => {
            const active = m === mode;
            const exists = m === "player" ? !!player : !!coach;
            return (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                disabled={active || busy}
                onPress={async () => {
                  // A role without a profile yet: fill it in first (as on the website).
                  if (!exists) return router.push({ pathname: "/profile-edit", params: { mode: m } });
                  try {
                    await switchMode(m);
                  } catch (e) {
                    toast.error(toFormError(e).message);
                  }
                }}
                style={[styles.switchTab, active ? { backgroundColor: colors.primary } : null]}
              >
                <Text variant="label" style={{ color: active ? colors.primaryText : colors.textSecondary }}>
                  {m === "player" ? "Игрок" : "Тренер"}
                  {exists ? "" : " +"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Card style={styles.hero}>
        <Pressable accessibilityRole="button" accessibilityLabel="Фото профиля" onPress={() => setPhotoMenu(true)} disabled={busy}>
          <View style={[styles.ring, { borderColor: colors.primary }]}>
            <Avatar fileId={user.avatarFileId} name={name} size={104} />
          </View>
          <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
            <Ionicons name="camera" size={15} color="#fff" />
          </View>
        </Pressable>
        <Text style={[styles.heroName, { color: colors.text }]}>{name}</Text>
        <View style={[styles.rolePill, { backgroundColor: colors.primaryGlow }]}>
          <Text variant="label" style={{ color: colors.primary }}>
            {mode === "coach" ? "Тренер" : "Игрок"}
          </Text>
        </View>
        {subtitle ? <Text muted>{subtitle}</Text> : null}
        <Text variant="caption" muted>
          {user.email}
        </Text>
        {heroStats.length > 0 ? (
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            {heroStats.map((s) => (
              <View key={s.label} style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{s.value}</Text>
                <Text variant="caption" muted>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {goal ? (
        <View style={[styles.goal, { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}>
          <Text variant="label" style={{ color: colors.primary, textTransform: "uppercase" }}>
            {mode === "player" ? "Цель сезона" : "О себе"}
          </Text>
          <Text>{goal}</Text>
        </View>
      ) : null}

      <Card>
        <View style={styles.cardHead}>
          <Text variant="heading" style={{ flex: 1 }}>
            {mode === "player" ? "Профиль игрока" : "Профиль тренера"}
          </Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push({ pathname: "/profile-edit", params: { mode } })}>
            <Text variant="label" style={{ color: colors.primary }}>
              Редактировать
            </Text>
          </Pressable>
        </View>
        <View style={styles.facts}>
          {facts
            .filter((f): f is { k: string; v: string } => f !== null)
            .map((f) => (
              <FactTile key={f.k} label={f.k} value={f.v} />
            ))}
        </View>
      </Card>

      <AchievementsGallery userId={user.id} editable />

      <View style={{ gap: 8 }}>
        {mode === "coach" ? <ListRow icon="pricetag-outline" title="Мои объявления" onPress={() => router.push("/my-listings")} /> : null}
        {mode === "coach" ? (
          <ListRow icon="mail-unread-outline" title="Входящие заявки" badge={extra.data?.pending} onPress={() => router.push("/bookings")} />
        ) : null}
        {mode === "coach" && features.trainerBalance ? <ListRow icon="wallet-outline" title="Финансы" onPress={() => router.push("/finance")} /> : null}
        {mode === "coach" ? <ListRow icon="library-outline" title="Библиотека" subtitle="Упражнения, планы, шаблоны" onPress={() => router.push("/library")} /> : null}
        {mode === "player" ? <ListRow icon="stats-chart-outline" title="Моя статистика" onPress={() => router.push("/stats")} /> : null}
        <ListRow icon="calendar-outline" title={mode === "coach" ? "Записи" : "Мои брони"} onPress={() => router.push("/bookings")} />
        <ListRow icon="notifications-outline" title="Уведомления" badge={unread.count} onPress={() => router.push("/notifications")} />
        <ListRow icon="shield-checkmark-outline" title="Аккаунт и безопасность" subtitle="Пароль, почта, устройства" onPress={() => router.push("/account")} />
        <ListRow icon="settings-outline" title="Настройки" subtitle="Тема, уведомления" onPress={() => router.push("/settings")} />
        <ListRow icon="document-text-outline" title="Документы" onPress={() => setDocs(true)} />
      </View>

      <Button title="Выйти из аккаунта" variant="secondary" onPress={() => setLeaving(true)} />
      <Button title="Удалить аккаунт" variant="ghost" onPress={() => router.push("/delete-account")} />

      <BottomSheet visible={photoMenu} title="Фото профиля" onClose={() => setPhotoMenu(false)}>
        <ListRow icon="image-outline" title={user.avatarFileId ? "Выбрать другое фото" : "Добавить фото"} onPress={() => void changePhoto()} />
        {user.avatarFileId ? <ListRow icon="trash-outline" title="Удалить фото" onPress={() => void removePhoto()} /> : null}
      </BottomSheet>
      <BottomSheet visible={docs} title="Документы" onClose={() => setDocs(false)}>
        {DOCUMENT_LIST.map((doc) => (
          <ListRow
            key={doc.key}
            icon="document-text-outline"
            title={doc.label}
            onPress={() => {
              setDocs(false);
              router.push({ pathname: "/legal/[key]", params: { key: doc.key } });
            }}
          />
        ))}
      </BottomSheet>
      <ConfirmModal
        visible={leaving}
        title="Выйти из аккаунта?"
        confirmLabel="Выйти"
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          void signOut();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4, gap: 2 },
  switchTab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10 },
  hero: { alignItems: "center", gap: 6, paddingVertical: 22 },
  ring: { borderWidth: 3, borderRadius: 60, padding: 4 },
  editBadge: { position: "absolute", right: 2, bottom: 2, width: 32, height: 32, borderRadius: 16, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  heroName: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, textTransform: "uppercase", textAlign: "center", marginTop: 6 },
  rolePill: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 14 },
  statsRow: { flexDirection: "row", alignSelf: "stretch", justifyContent: "space-around", borderTopWidth: 1, paddingTop: 14, marginTop: 8 },
  stat: { alignItems: "center", gap: 2, flex: 1 },
  statValue: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30 },
  goal: { borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexBasis: "47%", flexGrow: 1, borderRadius: radius.md, padding: 12, gap: 2 },
});
