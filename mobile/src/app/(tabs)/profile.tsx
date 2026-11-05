import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { removeUserAvatar, uploadUserAvatar } from "@/api/users";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { pickSquareImage } from "@/lib/pickImage";
import { Avatar } from "@/ui/Avatar";
import { useToast } from "@/ui/Toast";
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
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { state } = useProfile();

  async function changePhoto() {
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

  if (state.status !== "ready") return null;
  const { player, coach } = state.data;

  return (
    <Screen>
      <Text variant="title">Профиль</Text>
      <Card>
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          <Avatar fileId={user?.avatarFileId} name={[user?.firstName, user?.lastName].filter(Boolean).join(" ")} size={72} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">{[user?.firstName, user?.lastName].filter(Boolean).join(" ")}</Text>
            <Text muted>{user?.email}</Text>
          </View>
        </View>
        <Button title={user?.avatarFileId ? "Изменить фото" : "Добавить фото"} variant="secondary" onPress={changePhoto} loading={busy} />
        {user?.avatarFileId ? <Button title="Удалить фото" variant="ghost" onPress={removePhoto} disabled={busy} /> : null}
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
