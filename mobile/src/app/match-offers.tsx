import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { acceptCoachOffer, declineCoachOffer, getMatchOfferSettings, listCoachOffers, saveMatchOfferSettings, type CoachOfferStatus } from "@/api/matchOffers";
import { budgetText, MATCH_FORMAT_LABELS, MATCH_LEVEL_LABELS, whenText } from "@/api/matchRequests";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const STATUS: Record<CoachOfferStatus, string> = {
  proposed: "Ждёт вашего ответа", coach_declined: "Вы отказались", coach_accepted: "Ждёт ответа спортсмена",
  athlete_declined: "Спортсмен отказался", athlete_accepted: "Спортсмен выбрал вас", withdrawn: "Отозвано", expired: "Срок истёк",
};

export default function MatchOffersScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const data = useLoad(async () => {
    const [settings, offers] = await Promise.all([getMatchOfferSettings(), listCoachOffers()]);
    return { settings, offers };
  });
  const [terms, setTerms] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = data.data?.settings;
  const offers = data.data?.offers ?? [];
  const ordered = id ? [...offers.filter((offer) => offer.id === id), ...offers.filter((offer) => offer.id !== id)] : offers;

  async function run(action: () => Promise<unknown>, close?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      close?.();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      data.reload();
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Подбор клиентов" }} />
      <Screen header onRefresh={data.reload} refreshing={data.loading && !!data.data}>
        {data.loading && !data.data ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={data.reload} /> : null}
        {error && !terms && !declining ? <Notice kind="danger">{error}</Notice> : null}
        {settings ? (
          <Card>
            <Text variant="heading">{settings.enabled ? "Подбор включён" : "Подбор выключен"}</Text>
            <Text muted>Комиссия за первое занятие из подбора по умолчанию — {settings.firstSessionPercent}%. Для конкретного предложения действует процент в его карточке.</Text>
            <Button title={settings.enabled ? "Текущие условия" : "Прочитать условия и включить"} variant="secondary" disabled={busy} onPress={() => { setError(null); setTerms(true); }} />
            {settings.enabled ? <Button title="Выключить подбор" variant="ghost" disabled={busy} onPress={() => void run(() => saveMatchOfferSettings(false, null))} /> : null}
          </Card>
        ) : null}
        {data.data && !offers.length ? <Text muted>Предложений пока нет.</Text> : null}
        {ordered.map((offer) => {
          const r = offer.request;
          const details = [r.city, r.level ? MATCH_LEVEL_LABELS[r.level] : null, r.format ? MATCH_FORMAT_LABELS[r.format] : null, budgetText(r.budgetMin, r.budgetMax, r.currency), whenText(r.weekdays, r.dayParts)].filter(Boolean);
          return (
            <Card key={offer.id}>
              <Text variant="heading">{r.sport}</Text>
              <Text variant="label">{STATUS[offer.status] ?? "Статус обновляется"}</Text>
              <Text muted>{details.join(" · ")}</Text>
              {[r.goal, r.scheduleNote, r.comment, offer.adminMessage].filter(Boolean).map((line, index) => <Text key={index}>{line}</Text>)}
              <Text>Комиссия за первое занятие — {offer.firstSessionPercent}%.</Text>
              {offer.status === "proposed" ? (
                <>
                  <Text muted>Ответьте до {new Date(offer.expiresAt).toLocaleString("ru-RU")}</Text>
                  <Button title="Принять предложение" disabled={busy || !settings?.enabled || !settings.termsAccepted} onPress={() => void run(() => acceptCoachOffer(offer.id))} />
                  <Button title="Отказаться" variant="ghost" disabled={busy} onPress={() => { setError(null); setReason(""); setDeclining(offer.id); }} />
                </>
              ) : null}
            </Card>
          );
        })}
      </Screen>
      {settings ? (
        <BottomSheet visible={terms} title={settings.termsTitle} onClose={() => { if (!busy) setTerms(false); }}>
          {settings.terms.map((line, i) => <Text key={i}>{line}</Text>)}
          {error ? <Notice kind="danger">{error}</Notice> : null}
          {!settings.enabled ? <Button title="Принять условия и включить подбор" loading={busy} onPress={() => void run(() => saveMatchOfferSettings(true, settings.currentVersion), () => setTerms(false))} /> : null}
        </BottomSheet>
      ) : null}
      <BottomSheet visible={declining !== null} title="Отказаться от предложения" onClose={() => { if (!busy) setDeclining(null); }}>
        <TextField label="Причина, если хотите указать" value={reason} onChangeText={setReason} maxLength={500} multiline />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title="Отказаться" loading={busy} onPress={() => {
          if (declining) void run(() => declineCoachOffer(declining, reason.trim() || null), () => setDeclining(null));
        }} />
      </BottomSheet>
    </>
  );
}
