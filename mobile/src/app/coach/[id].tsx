import { Stack, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { getCoachPublicProfile, listCoachPublicListings, listCoachPublicReviews } from "@/api/coaches";
import { useLoad } from "@/lib/useLoad";
import { Card } from "@/ui/Card";
import { AchievementsGallery } from "@/profile/AchievementsGallery";
import { ReportButton } from "@/ui/ReportButton";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

/** A coach's public page: about, offers and reviews. */
export default function CoachScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loaded = useLoad(async () => {
    const [profile, listings, reviews] = await Promise.all([getCoachPublicProfile(id), listCoachPublicListings(id), listCoachPublicReviews(id)]);
    return { profile, listings, reviews };
  }, [id]);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Тренер не найден"} onRetry={loaded.reload} />;
  const { profile: p, listings, reviews } = loaded.data;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Тренер" }} />
      <Screen header>
        <Text variant="title">{p.fullName}</Text>
        <Text muted>{[p.sport, p.specialization, p.experienceYears != null ? `опыт ${p.experienceYears} л.` : null].filter(Boolean).join(" · ")}</Text>
        {p.averageRating !== null ? <Text>★ {p.averageRating.toFixed(1)} · отзывов: {p.reviewCount}</Text> : null}
        {p.description ? <Text>{p.description}</Text> : null}
        <AchievementsGallery userId={p.userId} editable={false} />
        <ReportButton targetType="user" targetId={p.userId} ownerUserId={p.userId} />

        <Text variant="heading">Предложения</Text>
        {listings.length === 0 ? <Text muted>Сейчас нет открытых предложений.</Text> : null}
        {listings.map((l) => (
          <Card key={l.id} onPress={() => router.push({ pathname: "/listing/[id]", params: { id: l.id } })}>
            <Text variant="label">{l.title}</Text>
            <Text muted>{l.pricePerSession !== null ? `${l.pricePerSession} ${l.currency}` : "Цена не указана"}</Text>
          </Card>
        ))}

        {reviews.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text variant="heading">Отзывы</Text>
            {reviews.map((r) => (
              <Card key={r.id}>
                <Text variant="label">
                  {r.athleteFirstName} · {"★".repeat(r.rating)}
                </Text>
                {r.text ? <Text>{r.text}</Text> : null}
              </Card>
            ))}
          </View>
        ) : null}
      </Screen>
    </>
  );
}
