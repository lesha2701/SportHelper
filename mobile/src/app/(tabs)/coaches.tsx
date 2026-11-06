import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { listListings } from "@/api/coachListings";
import { useAuth } from "@/auth/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { useProfile } from "@/profile/ProfileProvider";
import { activeCount, EMPTY_FILTERS, toQuery, type MarketFilterForm } from "@/shared/lib/marketFilters";
import { count } from "@/shared/lib/plural";
import type { CoachListingCard } from "@/shared/types/coachListing";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { PhotoBox } from "@/ui/PhotoBox";
import { Screen } from "@/ui/Screen";
import { SelectField } from "@/ui/SelectField";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const SPORTS = [{ value: "", title: "Все виды спорта" }, ...COMMON_SPORTS.map((s) => ({ value: s, title: s }))];
const RATINGS = [
  { value: "any", title: "Любой" },
  { value: "4.5", title: "4.5+" },
  { value: "4.8", title: "4.8+" },
];

function ListingCard({ l }: { l: CoachListingCard }) {
  const { colors } = useTheme();
  return (
    <Card onPress={() => router.push({ pathname: "/listing/[id]", params: { id: l.id } })}>
      <View style={styles.cardHead}>
        <Avatar name={l.coachFullName} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
            {l.title}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            {[l.coachFullName, l.sport, l.experienceYears != null ? `${l.experienceYears} лет опыта` : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      <PhotoBox fileId={l.photoFileId} height={170} />
      <View style={styles.cardFoot}>
        <Text style={[styles.price, { color: colors.primary }]}>{l.pricePerSession !== null ? `${l.pricePerSession} ₽` : "Цена по договорённости"}</Text>
        {l.averageRating !== null ? (
          <View style={styles.inline}>
            <Ionicons name="star" size={14} color={colors.warning} />
            <Text variant="caption">
              {l.averageRating.toFixed(1)} ({l.reviewCount})
            </Text>
          </View>
        ) : null}
      </View>
      {l.location || l.offersOnline ? (
        <View style={styles.inline}>
          <Ionicons name={l.location ? "location-outline" : "videocam-outline"} size={14} color={colors.textSecondary} />
          <Text variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
            {[l.location, l.offersOnline ? "онлайн" : null, l.offersOffline && !l.location ? "очно" : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** The coach marketplace: what coaches offer, narrowed by sport and the website's filters (city, price, rating, online). */
export default function CoachesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { state: profile } = useProfile();
  const isCoach = user?.preferredRole === "coach";
  // The catalogue opens on the sport the person gave at sign-up (the one of their current role).
  const mySport = profile.status === "ready" ? ((isCoach ? profile.data.coach?.sport : profile.data.player?.sport) ?? profile.data.player?.sport ?? profile.data.coach?.sport ?? "") : "";
  const [applied, setApplied] = useState<MarketFilterForm>({ ...EMPTY_FILTERS, sport: mySport });
  const [draft, setDraft] = useState<MarketFilterForm>(EMPTY_FILTERS);
  const [open, setOpen] = useState(false);
  const sportSet = useRef(mySport !== "");
  useEffect(() => {
    if (sportSet.current || !mySport) return;
    sportSet.current = true;
    setApplied((a) => ({ ...a, sport: mySport }));
  }, [mySport]);
  const sports = mySport && !COMMON_SPORTS.includes(mySport) ? [...SPORTS, { value: mySport, title: mySport }] : SPORTS;

  const listings = useLoad(async () => {
    const all = await listListings(toQuery(applied));
    // A coach sees other coaches' offers here; their own are under "Мои предложения".
    return all.filter((l) => l.coachUserId !== user?.id);
  }, [JSON.stringify(applied), user?.id]);

  const filtersOn = activeCount(applied);
  const set = (patch: Partial<MarketFilterForm>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Screen header onRefresh={listings.reload} refreshing={listings.loading && !!listings.data}>
      {isCoach ? <Button title="Мои предложения" variant="secondary" onPress={() => router.push("/my-listings")} /> : null}

      <SelectField label="Вид спорта" options={sports} value={applied.sport} onChange={(sport) => setApplied((a) => ({ ...a, sport }))} />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setDraft(applied);
          setOpen(true);
        }}
        style={[styles.filterButton, { backgroundColor: colors.surface, borderColor: filtersOn ? colors.primary : colors.borderStrong }]}
      >
        <Ionicons name="options-outline" size={20} color={filtersOn ? colors.primary : colors.text} />
        <Text variant="label" style={{ flex: 1, fontSize: 15, color: filtersOn ? colors.primary : colors.text }}>
          Фильтры{filtersOn ? ` · ${filtersOn}` : ""}
        </Text>
        <Text variant="caption" muted>
          город, цена, рейтинг
        </Text>
      </Pressable>

      {listings.loading && !listings.data ? <LoadingView /> : null}
      {listings.error && !listings.data ? <ErrorView message={listings.error} onRetry={listings.reload} /> : null}
      {listings.data ? (
        <Text muted>
          Найдено {count(listings.data.length, "предложение", "предложения", "предложений")}
        </Text>
      ) : null}
      {listings.data?.length === 0 ? (
        <Card>
          <Text variant="heading">Ничего не нашлось</Text>
          <Text muted>Попробуйте другой вид спорта или ослабьте фильтры.</Text>
          {filtersOn || applied.sport ? <Button title="Сбросить всё" variant="secondary" onPress={() => setApplied(EMPTY_FILTERS)} /> : null}
        </Card>
      ) : null}
      {listings.data?.map((l) => (
        <ListingCard key={l.id} l={l} />
      ))}

      <BottomSheet
        visible={open}
        title="Фильтры"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              title="Показать"
              onPress={() => {
                setApplied(draft);
                setOpen(false);
              }}
            />
            <Button title="Сбросить фильтры" variant="ghost" onPress={() => setDraft({ ...EMPTY_FILTERS, sport: draft.sport })} />
          </>
        }
      >
        <TextField label="Город" value={draft.city} onChangeText={(city) => set({ city })} placeholder="Например, Москва" />
        <View style={{ gap: 6 }}>
          <Text variant="label" muted>
            Цена за занятие, ₽
          </Text>
          <View style={styles.inline}>
            <View style={{ flex: 1 }}>
              <TextField label="От" value={draft.minPrice} onChangeText={(minPrice) => set({ minPrice })} keyboardType="number-pad" maxLength={6} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="До" value={draft.maxPrice} onChangeText={(maxPrice) => set({ maxPrice })} keyboardType="number-pad" maxLength={6} />
            </View>
          </View>
        </View>
        <Choice
          label="Рейтинг"
          layout="chips"
          options={RATINGS}
          value={draft.minRating === null ? "any" : String(draft.minRating)}
          onChange={(r) => set({ minRating: r === "any" ? null : Number(r) })}
        />
        <View style={styles.inline}>
          <Text style={{ flex: 1 }}>Только онлайн-занятия</Text>
          <Switch accessibilityLabel="Только онлайн-занятия" value={draft.onlineOnly} onValueChange={(onlineOnly) => set({ onlineOnly })} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: "row", gap: 12, alignItems: "center" },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23 },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  price: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterButton: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
});
