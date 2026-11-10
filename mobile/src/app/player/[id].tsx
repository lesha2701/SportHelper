import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";
import { getPlayerPublicProfile, getPlayerReviews } from "@/api/players";
import { useLoad } from "@/lib/useLoad";
import { AchievementsGallery } from "@/profile/AchievementsGallery";
import { pluralize } from "@/shared/lib/plural";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Card } from "@/ui/Card";
import { ReportButton } from "@/ui/ReportButton";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

/** A player's profile as the coach they booked sees it (from a request, a booking or the session): who they are and
 * what other coaches wrote about them. */
export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const data = useLoad(async () => {
    const [profile, reviews] = await Promise.all([getPlayerPublicProfile(id), getPlayerReviews(id).catch(() => null)]);
    return { profile, reviews };
  }, [id]);

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Профиль не найден"} onRetry={data.reload} />;
  const { profile: p, reviews } = data.data;
  const facts = [
    p.age !== null ? { k: "Возраст", v: `${p.age} ${pluralize(p.age, "год", "года", "лет")}` } : null,
    p.heightCm !== null ? { k: "Рост", v: `${p.heightCm} см` } : null,
    p.weightKg !== null ? { k: "Вес", v: `${p.weightKg} кг` } : null,
    p.level ? { k: "Уровень", v: SKILL_LEVEL_LABELS[p.level] } : null,
  ].filter((f): f is { k: string; v: string } => f !== null);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Профиль игрока" }} />
      <Screen header onRefresh={data.reload} refreshing={data.loading}>
        <Card style={{ alignItems: "center" }}>
          <Avatar fileId={p.avatarFileId} name={p.fullName} size={96} />
          <Text style={[styles.name, { color: colors.text }]}>{p.fullName}</Text>
          <Text muted>{[p.position, p.sport].filter(Boolean).join(" · ")}</Text>
          {reviews && reviews.average !== null ? (
            <View style={styles.row}>
              <Ionicons name="star" size={15} color={colors.warning} />
              <Text variant="label">
                {reviews.average.toFixed(1)} · {reviews.count} {pluralize(reviews.count, "отзыв", "отзыва", "отзывов")}
              </Text>
            </View>
          ) : null}
        </Card>

        {facts.length > 0 ? (
          <View style={styles.facts}>
            {facts.map((f) => (
              <Fact key={f.k} label={f.k} value={f.v} />
            ))}
          </View>
        ) : null}
        {p.goals ? (
          <Card>
            <Text variant="heading">Цели</Text>
            <Text>{p.goals}</Text>
          </Card>
        ) : null}
        {p.loadRestrictions ? (
          <Card>
            <Text variant="heading">Ограничения по нагрузке</Text>
            <Text>{p.loadRestrictions}</Text>
          </Card>
        ) : null}

        <AchievementsGallery userId={p.userId} editable={false} />

        <Card>
          <Text variant="heading">Отзывы тренеров</Text>
          {!reviews || reviews.reviews.length === 0 ? <Text muted>Об этом игроке пока нет отзывов.</Text> : null}
          {reviews?.reviews.map((r) => (
            <View key={r.id} style={[styles.review, { borderTopColor: colors.border }]}>
              <View style={styles.row}>
                <Text variant="label" style={{ flex: 1 }}>
                  {r.coachName}
                </Text>
                <Text style={{ color: colors.warning }}>{"★".repeat(r.rating)}</Text>
              </View>
              {r.text ? <Text>{r.text}</Text> : null}
              <Text variant="caption" muted>
                {new Date(r.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              </Text>
            </View>
          ))}
        </Card>
        <ReportButton targetType="user" targetId={p.userId} ownerUserId={p.userId} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, textTransform: "uppercase", textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexBasis: "47%", flexGrow: 1, borderRadius: radius.md, padding: 12, gap: 2 },
  review: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 4 },
});
