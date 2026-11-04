import { router } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { years } from "@/shared/lib/plural";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const { state } = useProfile();
  if (state.status !== "ready") return null;
  const { player, coach } = state.data;

  return (
    <Screen>
      <Text variant="title">Профиль</Text>
      <Card>
        <Text variant="heading">{[user?.firstName, user?.lastName].filter(Boolean).join(" ")}</Text>
        <Text muted>{user?.email}</Text>
      </Card>

      {player ? (
        <Card>
          <Text variant="heading">Игрок</Text>
          <Row label="Имя" value={player.fullName} />
          <Row label="Вид спорта" value={player.sport} />
          <Row label="Позиция" value={player.position} />
          <Row label="Уровень" value={player.level ? SKILL_LEVEL_LABELS[player.level] : null} />
          <Row label="Возраст" value={player.age} />
          <Row label="Рост, см" value={player.heightCm} />
          <Row label="Вес, кг" value={player.weightKg} />
          <Row label="Цели" value={player.goals} />
          <Row label="Ограничения по нагрузке" value={player.loadRestrictions} />
          <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/profile-edit", params: { mode: "player" } })} />
        </Card>
      ) : null}

      {coach ? (
        <Card>
          <Text variant="heading">Тренер</Text>
          <Row label="Имя" value={coach.fullName} />
          <Row label="Вид спорта" value={coach.sport} />
          <Row label="Опыт" value={coach.experienceYears != null ? years(coach.experienceYears) : null} />
          <Row label="Специализация" value={coach.specialization} />
          <Row label="О себе" value={coach.description} />
          <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/profile-edit", params: { mode: "coach" } })} />
        </Card>
      ) : null}

      <Button title="Настройки" variant="secondary" onPress={() => router.push("/settings")} />
    </Screen>
  );
}
