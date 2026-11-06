import { Stack, router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { ApiError } from "@/api/client";
import { getMemberPlayerProfile } from "@/api/teams";
import { useLoad } from "@/lib/useLoad";
import { pluralize } from "@/shared/lib/plural";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

/** A team member's player profile, for the team's coaches (the website's PlayerProfileView), with their statistics. */
export default function MemberProfileScreen() {
  const { id, userId, name } = useLocalSearchParams<{ id: string; userId: string; name?: string }>();
  const { colors } = useTheme();
  const profile = useLoad(
    () =>
      getMemberPlayerProfile(id, userId).catch((e: unknown) => {
        if (e instanceof ApiError && e.code === "not_found") return null;
        throw e;
      }),
    [id, userId],
  );

  if (profile.loading && profile.data === undefined) return <LoadingView />;
  if (profile.error) return <ErrorView message={profile.error} onRetry={profile.reload} />;
  const p = profile.data;
  const title = p?.fullName ?? name ?? "Участник";
  const facts = p
    ? [
        { k: "Вид спорта", v: p.sport },
        p.position ? { k: "Позиция", v: p.position } : null,
        p.level ? { k: "Уровень", v: SKILL_LEVEL_LABELS[p.level] } : null,
        p.age !== null ? { k: "Возраст", v: `${p.age} ${pluralize(p.age, "год", "года", "лет")}` } : null,
        p.heightCm !== null ? { k: "Рост", v: `${p.heightCm} см` } : null,
        p.weightKg !== null ? { k: "Вес", v: `${p.weightKg} кг` } : null,
      ].filter((f): f is { k: string; v: string } => f !== null)
    : [];

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Профиль игрока" }} />
      <Screen header onRefresh={profile.reload} refreshing={profile.loading}>
        <Card style={{ alignItems: "center" }}>
          <Avatar name={title} size={88} />
          <Text style={[styles.name, { color: colors.text }]}>{title}</Text>
        </Card>
        {!p ? <EmptyView title="Профиль игрока не заполнен" hint="Участник ещё не рассказал о себе." /> : null}
        {facts.length > 0 ? (
          <View style={styles.facts}>
            {facts.map((f) => (
              <View key={f.k} style={[styles.fact, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text variant="caption" muted>
                  {f.k}
                </Text>
                <Text variant="label">{f.v}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {p?.goals ? (
          <Card>
            <Text variant="heading">Цели</Text>
            <Text>{p.goals}</Text>
          </Card>
        ) : null}
        {p?.loadRestrictions ? (
          <Card>
            <Text variant="heading">Ограничения по нагрузке</Text>
            <Text>{p.loadRestrictions}</Text>
          </Card>
        ) : null}
        <Button title="Статистика игрока" variant="secondary" onPress={() => router.push({ pathname: "/stats", params: { userId, name: title } })} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, textTransform: "uppercase", textAlign: "center" },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 2 },
});
