import { router } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { SKILL_LEVEL_LABELS, type ProfileMe } from "@/shared/types/profile";
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
        <Text variant="heading">Скоро в приложении</Text>
        <Text muted>
          {mode === "coach"
            ? "Команды, календарь тренировок, задания и матчи появятся в следующих обновлениях."
            : "Календарь, тренировки, задания и статистика появятся в следующих обновлениях."}
        </Text>
      </Card>
    </Screen>
  );
}
