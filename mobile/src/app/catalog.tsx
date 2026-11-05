import { Stack, router } from "expo-router";
import { useState } from "react";
import { listListings } from "@/api/coachListings";
import { useLoad } from "@/lib/useLoad";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

const SPORTS = [{ value: "", title: "Все" }, ...COMMON_SPORTS.map((s) => ({ value: s, title: s }))];

/** Coaches offering sessions: pick a sport, open an offer, book a time. */
export default function CatalogScreen() {
  const [sport, setSport] = useState("");
  const listings = useLoad(() => listListings(sport ? { sport } : {}), [sport]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Каталог тренеров" }} />
      <Screen>
        <Choice layout="chips" options={SPORTS} value={sport} onChange={setSport} />
        {listings.loading && !listings.data ? <LoadingView /> : null}
        {listings.error && !listings.data ? <ErrorView message={listings.error} onRetry={listings.reload} /> : null}
        {listings.data?.length === 0 ? <Text muted>Предложений по этому виду спорта пока нет.</Text> : null}
        {listings.data?.map((l) => (
          <Card key={l.id} onPress={() => router.push({ pathname: "/listing/[id]", params: { id: l.id } })}>
            <Text variant="label">{l.title}</Text>
            <Text muted>
              {l.coachFullName} · {l.sport}
            </Text>
            <Text variant="caption" muted>
              {[
                l.pricePerSession !== null ? `${l.pricePerSession} ${l.currency}` : "Цена не указана",
                l.averageRating !== null ? `★ ${l.averageRating.toFixed(1)} (${l.reviewCount})` : null,
                l.location,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Card>
        ))}
      </Screen>
    </>
  );
}
