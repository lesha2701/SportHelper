import { ProBadge } from "@/ui/ProBadge";
import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { createBooking } from "@/api/bookings";
import { getListingOpenSlots, getListingProfile } from "@/api/coachListings";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { dayChip, groupSlotsByDay, timeOf } from "@/shared/lib/bookingLabels";
import { addDays, formatRuDate, parseRuDate, todayIso } from "@/shared/lib/dates";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { CalendarDatePicker } from "@/ui/CalendarDatePicker";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { PhotoBox } from "@/ui/PhotoBox";
import { ReportButton } from "@/ui/ReportButton";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { DateField } from "@/ui/DateTimeFields";

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fact, { backgroundColor: colors.surfaceAlt }]}>
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text variant="caption">{text}</Text>
    </View>
  );
}

/** A coach's offer: what it is, who runs it, and booking a free time (pick a day, then a time). */
export default function ListingScreen() {
  const { id, booking } = useLocalSearchParams<{ id: string; booking?: string }>();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const focusedBooking = useRef<string | null>(null);
  const { user } = useAuth();
  const { colors } = useTheme();
  const loaded = useLoad(() => getListingProfile(id), [id]);
  const today = todayIso();
  const [dateText, setDateText] = useState("");
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const dates = useLoad(async () => {
    if (!loaded.data || loaded.data.id !== id || loaded.data.coachUserId === user?.id) return null;
    const first = requestedDate ?? today;
    const last = addDays(first, requestedDate ? 90 : 14);
    return { requestedDate, days: groupSlotsByDay(await getListingOpenSlots(id, first, last)) };
  }, [id, loaded.data?.id, loaded.data?.coachUserId, user?.id, requestedDate, today]);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [format, setFormat] = useState<"online" | "offline" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Предложение не найдено"} onRetry={loaded.reload} />;
  const p = loaded.data;
  const dateResults = dates.data?.requestedDate === requestedDate ? dates.data : null;
  const days = dateResults?.days ?? [];
  const own = p.coachUserId === user?.id;
  const chosenDay = day ?? requestedDate ?? days[0]?.day ?? null;
  const daySlots = days.find((d) => d.day === chosenDay)?.slots ?? [];
  const formats = [
    ...(p.offersOnline ? [{ value: "online" as const, title: "Онлайн" }] : []),
    ...(p.offersOffline ? [{ value: "offline" as const, title: "Очно" }] : []),
  ];
  const chosenFormat = format ?? (formats.length === 1 ? formats[0]!.value : null);

  function searchDate(date = parseRuDate(dateText)) {
    if (!date || date < today || date > addDays(today, 365)) {
      setDateError("Выберите дату на ближайший год.");
      return;
    }
    setDateError(null);
    setDay(null);
    setSlot(null);
    setError(null);
    if (date === requestedDate) dates.reload();
    else setRequestedDate(date);
  }

  async function book() {
    if (!slot || !daySlots.some((time) => time.startsAt === slot)) return setError("Выберите время.");
    if (!chosenFormat) return setError("Выберите формат занятия.");
    setBusy(true);
    setError(null);
    try {
      await createBooking({ listing_id: p.id, starts_at: slot, format: chosenFormat });
      router.replace("/bookings");
    } catch (e) {
      setError(toFormError(e).message);
      setSlot(null);
      dates.reload();
    } finally {
      setBusy(false);
    }
  }

  const chosen = slot ? `${dayChip(slot.slice(0, 10)).date}, ${timeOf(slot)}` : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Предложение" }} />
      <Screen header scrollRef={scroll}>
        <PhotoBox fileId={p.photoFileId} height={210} hint="Тренер ещё не добавил фото" />
        <Text variant="title" style={{ fontSize: 26, lineHeight: 32 }}>
          {p.title}
        </Text>

        <Card onPress={() => router.push({ pathname: "/coach/[id]", params: { id: p.coachUserId } })}>
          <View style={styles.row}>
            <Avatar name={p.coachFullName} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" style={{ fontSize: 16 }}>
                {p.coachFullName}{p.coachIsPro ? <> <ProBadge /></> : null}
              </Text>
              <Text variant="caption" muted>
                {[p.sport, p.specialization, p.experienceYears != null ? `${p.experienceYears} лет опыта` : null].filter(Boolean).join(" · ")}
              </Text>
              {p.averageRating !== null ? (
                <View style={styles.row}>
                  <Ionicons name="star" size={13} color={colors.warning} />
                  <Text variant="caption">
                    {p.averageRating.toFixed(1)} · отзывов: {p.reviewCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </View>
        </Card>

        <View style={styles.facts}>
          <Text style={[styles.price, { color: colors.primary }]}>{p.pricePerSession !== null ? `${p.pricePerSession} ₽` : "Цена по договорённости"}</Text>
        </View>
        <View style={styles.facts}>
          {p.sessionDurationMinutes ? <Fact icon="time-outline" text={`${p.sessionDurationMinutes} мин`} /> : null}
          {p.offersOffline ? <Fact icon="people-outline" text="Очно" /> : null}
          {p.offersOnline ? <Fact icon="videocam-outline" text="Онлайн" /> : null}
          {p.location ? <Fact icon="location-outline" text={p.location} /> : null}
        </View>
        {p.description ? <Text>{p.description}</Text> : null}
        {p.oneOffDates.length ? (
          <Card>
            <Text variant="heading">Разовые даты</Text>
            {p.oneOffDates.map((date) => (
              <Text key={date.id}>{formatRuDate(date.slot_date)}, {date.start_time.slice(0, 5)}–{date.end_time.slice(0, 5)}</Text>
            ))}
          </Card>
        ) : null}

        {!own ? (
          <View onLayout={(event) => {
            if (booking !== "1" || focusedBooking.current === id) return;
            focusedBooking.current = id;
            scroll.current?.scrollTo({ y: event.nativeEvent.layout.y + 12, animated: false });
          }}>
            <Card>
              <Text variant="heading">Записаться</Text>
              <DateField label="Выбрать другую дату" value={dateText} onChange={setDateText} error={dateError} shortcuts />
              <Button title="Показать свободное время" variant="secondary" onPress={() => searchDate()} />
              <CalendarDatePicker earliest={today} latest={addDays(today, 365)} selected={requestedDate} onSelect={(value) => {
                setDateText(formatRuDate(value));
                searchDate(value);
              }} />
              {dates.loading ? <LoadingView /> : null}
              {dates.error ? <ErrorView message={dates.error} onRetry={dates.reload} /> : null}
              {!dates.loading && !dates.error && !daySlots.length ? (
                <Text muted>{requestedDate ? `На ${formatRuDate(requestedDate)} свободного времени нет.` : "Свободного времени на ближайшие две недели нет."}</Text>
              ) : null}
              {requestedDate && days.length > 0 && !daySlots.length ? <Text variant="label">Ближайшие свободные дни</Text> : null}
              {error ? <Notice kind="danger">{error}</Notice> : null}
              {days.length > 0 && !dates.error ? (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
                    {days.map((d) => {
                      const active = d.day === chosenDay;
                      const label = dayChip(d.day);
                      return (
                        <Pressable
                          key={d.day}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => {
                            setDay(d.day);
                            setSlot(null);
                          }}
                          style={[styles.dayChip, { borderColor: active ? colors.primary : colors.borderStrong, backgroundColor: active ? colors.primary : colors.surface }]}
                        >
                          <Text variant="caption" style={{ color: active ? colors.primaryText : colors.textSecondary }}>
                            {label.weekday}
                          </Text>
                          <Text variant="label" style={{ color: active ? colors.primaryText : colors.text }}>
                            {label.date}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.timeGrid}>
                    {daySlots.map((s) => {
                      const active = s.startsAt === slot;
                      return (
                        <Pressable
                          key={s.startsAt}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => {
                            setSlot(s.startsAt);
                            setError(null);
                          }}
                          style={[styles.timeChip, { borderColor: active ? colors.primary : colors.borderStrong, backgroundColor: active ? colors.primaryGlow : colors.surface }]}
                        >
                          <Text variant="label" style={{ color: active ? colors.primary : colors.text }}>
                            {timeOf(s.startsAt)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {formats.length > 1 ? <Choice label="Формат" layout="chips" options={formats} value={chosenFormat} onChange={setFormat} /> : null}
                  <Button title={chosen ? `Записаться на ${chosen}` : "Выберите время"} onPress={book} loading={busy} disabled={!slot || dates.loading || !daySlots.some((time) => time.startsAt === slot)} />
                  <Text variant="caption" muted>
                    Тренер подтвердит запись, после этого занятие можно оплатить.
                  </Text>
                </>
              ) : null}
            </Card>
          </View>
        ) : (
          <Notice>Это ваше предложение: так его видят спортсмены.</Notice>
        )}

        {p.recentReviews.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text variant="heading">Отзывы</Text>
            {p.recentReviews.map((r) => (
              <Card key={r.id}>
                <View style={styles.row}>
                  <Text variant="label" style={{ flex: 1 }}>
                    {r.athleteFirstName}
                  </Text>
                  <Text style={{ color: colors.warning }}>{"★".repeat(r.rating)}</Text>
                </View>
                {r.text ? <Text>{r.text}</Text> : null}
              </Card>
            ))}
          </View>
        ) : null}

        <ReportButton targetType="listing" targetId={p.id} ownerUserId={p.coachUserId} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  fact: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill },
  price: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  dayStrip: { gap: 8, paddingVertical: 2 },
  dayChip: { width: 64, paddingVertical: 8, borderWidth: 1, borderRadius: radius.md, alignItems: "center", gap: 2 },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeChip: { width: "22.5%", minWidth: 68, paddingVertical: 10, borderWidth: 1, borderRadius: radius.md, alignItems: "center" },
});
