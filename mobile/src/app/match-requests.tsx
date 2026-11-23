import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { acceptMatchOffer, budgetText, cancelMatchRequest, createMatchRequest, DAY_PART_LABELS, declineMatchOffer, listMyMatchRequests, MATCH_FORMAT_LABELS, MATCH_LEVEL_LABELS, MATCH_STATUS_LABELS, WEEKDAY_LABELS, whenText, type DayPart, type MatchFormat, type MatchLevel, type MatchRequestInput } from "@/api/matchRequests";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { useProfile } from "@/profile/ProfileProvider";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SelectField } from "@/ui/SelectField";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ProBadge } from "@/ui/ProBadge";

const options = <T extends string>(labels: Record<T, string>) =>
  Object.entries(labels).map(([value, title]) => ({ value: value as T, title: String(title) }));
const nullable = (value: string) => value.trim() || null;
const money = (value: string) => value.trim() ? Number(value.trim().replace(",", ".")) : null;
const toggled = <T,>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

function MatchRequestForm({ initialSport, onCreated }: { initialSport: string; onCreated: () => void }) {
  const [form, setForm] = useState<MatchRequestInput>({
    sport: initialSport, goal: null, level: null, format: null, city: null, budgetMin: null, budgetMax: null,
    weekdays: [], dayParts: [], scheduleNote: null, comment: null,
  });
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (data: Partial<MatchRequestInput>) => setForm((current) => ({ ...current, ...data }));
  const sports = [...new Set([...COMMON_SPORTS, initialSport].filter(Boolean))];

  async function submit() {
    const budgetMin = money(min);
    const budgetMax = money(max);
    if (form.sport.length < 2) return setError("Выберите вид спорта.");
    if ([budgetMin, budgetMax].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return setError("Укажите корректный бюджет.");
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) return setError("Минимальный бюджет должен быть не больше максимального.");
    setBusy(true);
    setError(null);
    try {
      await createMatchRequest({
        ...form, budgetMin, budgetMax,
        goal: nullable(form.goal ?? ""), city: nullable(form.city ?? ""),
        scheduleNote: nullable(form.scheduleNote ?? ""), comment: nullable(form.comment ?? ""),
      });
      onCreated();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Анкета спортсмена</Text>
      <SelectField label="Вид спорта" options={sports.map((value) => ({ value, title: value }))} value={form.sport} onChange={(sport) => patch({ sport })} />
      <TextField label="Цель" value={form.goal ?? ""} onChangeText={(goal) => patch({ goal })} maxLength={1000} multiline />
      <Choice label="Уровень" layout="chips" options={options(MATCH_LEVEL_LABELS)} value={form.level} onChange={(level) => patch({ level: form.level === level ? null : level as MatchLevel })} />
      <Choice label="Формат" layout="chips" options={options(MATCH_FORMAT_LABELS)} value={form.format} onChange={(format) => patch({ format: form.format === format ? null : format as MatchFormat })} />
      <TextField label="Город" value={form.city ?? ""} onChangeText={(city) => patch({ city })} maxLength={100} />
      <TextField label="Бюджет от, ₽" value={min} onChangeText={setMin} keyboardType="decimal-pad" maxLength={12} />
      <TextField label="Бюджет до, ₽" value={max} onChangeText={setMax} keyboardType="decimal-pad" maxLength={12} />
      <Choice label="Дни недели" layout="chips" options={WEEKDAY_LABELS.map((title, i) => ({ title, value: String(i) }))} value={null} selected={form.weekdays.map(String)} onChange={(day) => patch({ weekdays: toggled(form.weekdays, Number(day)) })} />
      <Choice label="Время суток" layout="chips" options={options(DAY_PART_LABELS)} value={null} selected={form.dayParts} onChange={(part) => patch({ dayParts: toggled(form.dayParts, part as DayPart) })} />
      <TextField label="Уточнение по времени" value={form.scheduleNote ?? ""} onChangeText={(scheduleNote) => patch({ scheduleNote })} maxLength={500} multiline />
      <TextField label="Комментарий" value={form.comment ?? ""} onChangeText={(comment) => patch({ comment })} maxLength={1500} multiline />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Отправить анкету" onPress={() => void submit()} loading={busy} />
    </Card>
  );
}

export default function MatchRequestsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state } = useProfile();
  const data = useLoad(listMyMatchRequests);
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const requests = data.data ?? [];
  const ordered = id ? [...requests.filter((request) => request.id === id), ...requests.filter((request) => request.id !== id)] : requests;

  async function run(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      setNotice(message);
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      data.reload();
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Подобрать тренера" }} />
      <Screen header onRefresh={data.reload} refreshing={data.loading && !!data.data}>
        <Text muted>Расскажите, какое занятие вам нужно. Мы подберём тренера и сообщим, когда он ответит.</Text>
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title={writing ? "Свернуть анкету" : "Новая заявка"} variant="secondary" onPress={() => setWriting(!writing)} />
        {writing ? <MatchRequestForm initialSport={state.status === "ready" ? state.data.player?.sport ?? "" : ""} onCreated={() => {
          setWriting(false);
          setNotice("Анкета отправлена. Как только тренер ответит, мы пришлём уведомление.");
          data.reload();
        }} /> : null}
        {data.loading && !data.data ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={data.reload} /> : null}
        {data.data && !requests.length ? <Text muted>У вас пока нет заявок.</Text> : null}
        {ordered.map((request) => (
          <Card key={request.id}>
            <Text variant="heading">{request.sport}</Text>
            <Text variant="label">{MATCH_STATUS_LABELS[request.status] ?? "Статус обновляется"}</Text>
            <Text muted>{[request.city, budgetText(request.budgetMin, request.budgetMax, request.currency), whenText(request.weekdays, request.dayParts)].filter(Boolean).join(" · ")}</Text>
            {request.goal ? <Text>{request.goal}</Text> : null}
            {request.offers.map((offer) => (
              <Card key={offer.id}>
                <Text variant="label">{offer.coach.fullName}{offer.coach.isPro ? " " : ""}{offer.coach.isPro ? <ProBadge /> : null}</Text>
                <Text muted>{[offer.coach.sport, offer.coach.specialization, offer.coach.averageRating?.toFixed(1)].filter(Boolean).join(" · ")}</Text>
                {offer.expiresAt ? <Text muted>Выберите до {new Date(offer.expiresAt).toLocaleString("ru-RU")}</Text> : null}
                <Button title="Профиль тренера" variant="secondary" onPress={() => router.push({ pathname: "/coach/[id]", params: { id: offer.coach.userId } })} />
                {offer.status === "coach_accepted" ? (
                  <>
                    {offer.listings.map((listing) => <Text key={listing.id}>{listing.title}{listing.pricePerSession !== null ? ` · ${listing.pricePerSession} ₽` : ""}</Text>)}
                    <Button title="Выбрать тренера" disabled={busy} onPress={() => void run(() => acceptMatchOffer(offer.id), "Тренер выбран. Теперь можно записаться на занятие.")} />
                    <Button title="Отказаться" variant="ghost" disabled={busy} onPress={() => void run(() => declineMatchOffer(offer.id), "Подбор продолжается.")} />
                  </>
                ) : offer.status === "athlete_accepted" ? (
                  <>
                    <Text>Первое занятие оплачивается в приложении.</Text>
                    {offer.listings.map((listing) => (
                      <Button key={listing.id} title={`Записаться · ${listing.title}`} onPress={() => router.push({ pathname: "/listing/[id]", params: { id: listing.id, booking: "1" } })} />
                    ))}
                  </>
                ) : null}
              </Card>
            ))}
            {request.status === "new" || request.status === "in_progress" ? <Button title="Отозвать заявку" variant="ghost" disabled={busy} onPress={() => setCancelId(request.id)} /> : null}
          </Card>
        ))}
        <ConfirmModal visible={cancelId !== null} title="Отозвать заявку?" confirmLabel="Отозвать" destructive onCancel={() => setCancelId(null)} onConfirm={() => {
          if (cancelId) void run(() => cancelMatchRequest(cancelId), "Заявка отозвана.");
          setCancelId(null);
        }} />
      </Screen>
    </>
  );
}
