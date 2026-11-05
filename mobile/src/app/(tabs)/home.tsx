import { router } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useFeatures } from "@/lib/useFeatures";
import { useProfile } from "@/profile/ProfileProvider";
import { SKILL_LEVEL_LABELS, type ProfileMe } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { years } from "@/shared/lib/plural";

type Mode = "player" | "coach";

function currentMode(profile: ProfileMe, preferred: Mode | null): Mode {
  if (profile.activeMode) return profile.activeMode;
  if (profile.player && !profile.coach) return "player";
  if (profile.coach && !profile.player) return "coach";
  return preferred ?? "player";
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { state } = useProfile();
  const features = useFeatures();
  if (state.status !== "ready") return null;

  const profile = state.data;
  const mode = currentMode(profile, user?.preferredRole ?? null);
  const player = profile.player;
  const coach = profile.coach;

  return (
    <Screen>
      <Text muted>{mode === "coach" ? "Кабинет тренера" : "Кабинет игрока"}</Text>
      <Text variant="title">Привет, {user?.firstName}!</Text>

      {mode === "player" && player ? (
        <Card onPress={() => router.push("/profile")}>
          <Text variant="heading">{player.sport}</Text>
          <Text muted>
            {[player.position, player.level ? SKILL_LEVEL_LABELS[player.level] : null].filter(Boolean).join(" · ") || "Уровень не указан"}
          </Text>
          {player.goals ? <Text>{player.goals}</Text> : null}
        </Card>
      ) : null}

      {mode === "coach" && coach ? (
        <Card onPress={() => router.push("/profile")}>
          <Text variant="heading">{coach.sport}</Text>
          <Text muted>
            {[coach.specialization, coach.experienceYears != null ? `${years(coach.experienceYears)} опыта` : null].filter(Boolean).join(" · ") ||
              "Специализация не указана"}
          </Text>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">Разделы</Text>
        <Button title="Уведомления" variant="secondary" onPress={() => router.push("/notifications")} />
        <Button title="Поиск" variant="secondary" onPress={() => router.push("/search")} />
        {mode === "player" ? <Button title="Моя статистика" variant="secondary" onPress={() => router.push("/stats")} /> : null}
        <Button title={mode === "coach" ? "Записи ко мне" : "Мои записи"} variant="secondary" onPress={() => router.push("/bookings")} />
        {mode === "player" ? <Button title="Каталог тренеров" variant="secondary" onPress={() => router.push("/catalog")} /> : null}
        {mode === "coach" ? <Button title="Библиотека" variant="secondary" onPress={() => router.push("/library")} /> : null}
        {mode === "coach" ? <Button title="Мои предложения" variant="secondary" onPress={() => router.push("/my-listings")} /> : null}
        {mode === "coach" && features.trainerBalance ? <Button title="Финансы" variant="secondary" onPress={() => router.push("/finance")} /> : null}
      </Card>
    </Screen>
  );
}
