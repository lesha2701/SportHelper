import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { createBooking } from "@/api/bookings";
import { getListingOpenSlots, getListingProfile } from "@/api/coachListings";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { addDays, todayIso } from "@/shared/lib/dates";
import { formatStart } from "@/shared/lib/bookingLabels";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ReportButton } from "@/ui/ReportButton";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const loaded = useLoad(async () => {
    const profile = await getListingProfile(id);
    const slots = await getListingOpenSlots(id, todayIso(), addDays(todayIso(), 14));
    return { profile, slots };
  }, [id]);
  const [slot, setSlot] = useState<string | null>(null);
  const [format, setFormat] = useState<"online" | "offline" | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Предложение не найдено"} onRetry={loaded.reload} />;
  const { profile: p, slots } = loaded.data;
  const formats = [
    ...(p.offersOnline ? [{ value: "online" as const, title: "Онлайн" }] : []),
    ...(p.offersOffline ? [{ value: "offline" as const, title: "Очно" }] : []),
  ];
  const chosenFormat = format ?? (formats.length === 1 ? formats[0]!.value : null);

  async function book() {
    if (!slot) return setError("Выберите время.");
    if (!chosenFormat) return setError("Выберите формат занятия.");
    setBusy(true);
    setError(null);
    try {
      await createBooking({ listing_id: p.id, starts_at: slot, format: chosenFormat, athlete_notes: notes.trim() || null });
      router.replace("/bookings");
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Предложение" }} />
      <Screen header>
        <Text variant="title">{p.title}</Text>
        <Card onPress={() => router.push({ pathname: "/coach/[id]", params: { id: p.coachUserId } })}>
          <Text variant="label">{p.coachFullName}</Text>
          <Text muted>{[p.sport, p.specialization, p.experienceYears != null ? `опыт ${p.experienceYears} л.` : null].filter(Boolean).join(" · ")}</Text>
          {p.averageRating !== null ? <Text variant="caption">★ {p.averageRating.toFixed(1)} · отзывов: {p.reviewCount}</Text> : null}
        </Card>
        <Card>
          <Text variant="heading">{p.pricePerSession !== null ? `${p.pricePerSession} ${p.currency}` : "Цена не указана"}</Text>
          <Text muted>
            {[p.sessionDurationMinutes ? `${p.sessionDurationMinutes} мин` : null, p.location, p.offersOnline ? "онлайн" : null, p.offersOffline ? "очно" : null].filter(Boolean).join(" · ")}
          </Text>
          {p.description ? <Text>{p.description}</Text> : null}
        </Card>

        <ReportButton targetType="listing" targetId={p.id} ownerUserId={p.coachUserId} />
        <Text variant="heading">Запись</Text>
        {slots.length === 0 ? <Text muted>Свободных времён на ближайшие две недели нет.</Text> : null}
        {slots.length > 0 ? (
          <>
            <Choice label="Время" layout="chips" options={slots.slice(0, 40).map((s) => ({ value: s.startsAt, title: formatStart(s.startsAt) }))} value={slot} onChange={setSlot} />
            {formats.length > 1 ? <Choice label="Формат" layout="chips" options={formats} value={chosenFormat} onChange={setFormat} /> : null}
            <TextField label="Пожелания тренеру" value={notes} onChangeText={setNotes} multiline numberOfLines={3} maxLength={500} />
            {error ? <Notice kind="danger">{error}</Notice> : null}
            <Button title="Записаться" onPress={book} loading={busy} />
            <Text variant="caption" muted>
              Тренер подтвердит запись, после этого можно оплатить занятие.
            </Text>
          </>
        ) : null}

        {p.recentReviews.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text variant="heading">Отзывы</Text>
            {p.recentReviews.map((r) => (
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
