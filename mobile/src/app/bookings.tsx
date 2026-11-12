import { Stack, router } from "expo-router";
import { CancelBooking, CancellationNote } from "@/booking/CancelBooking";
import { CoachSessionActions, PlanPicker, ReviewSheet } from "@/booking/SessionParts";
import { SessionConfirmation } from "@/booking/SessionConfirmation";
import { useState } from "react";
import { useChatUnread } from "@/lib/useChatUnread";
import { bookingHasChat } from "@/shared/types/chat";
import { confirmBooking, declineBooking, listCoachBookings, listCoachPendingBookings, listMyBookings, reviewBooking } from "@/api/bookings";
import { openPaymentPage, startBookingPayment, syncBookingPayment } from "@/api/payments";
import { useAuth } from "@/auth/AuthProvider";
import { useFeatures } from "@/lib/useFeatures";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { PAYMENT_STATUS_LABELS, bookingStatusLabel, canPay, formatStart } from "@/shared/lib/bookingLabels";
import type { Booking, PendingBooking } from "@/shared/types/booking";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

/** «Чат с тренером» / «Чат с игроком»: only for a confirmed lesson that is paid (or free), when the server opens the chat. */
function ChatButton({ b, label, unread }: { b: Booking; label: string; unread: number }) {
  if (!bookingHasChat(b)) return null;
  return (
    <Button
      title={unread > 0 ? `${label} · ${unread > 9 ? "9+" : unread}` : label}
      variant="secondary"
      onPress={() => router.push({ pathname: "/chat/[kind]/[id]", params: { kind: "booking", id: b.id } })}
    />
  );
}

function PlayerBooking({ b, onChanged, unread }: { b: Booking; onChanged: () => void; unread: number }) {
  const toast = useToast();
  const features = useFeatures();
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      const { confirmationUrl } = await startBookingPayment(b.id);
      await openPaymentPage(confirmationUrl);
    } catch (e) {
      toast.error(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    try {
      await syncBookingPayment(b.id);
      onChanged();
    } catch (e) {
      toast.error(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="label">{b.listingTitle ?? "Занятие"}</Text>
      <Text muted>
        {b.coachFullName} · {formatStart(b.startsAt)} · {b.durationMinutes} мин · {b.format === "online" ? "онлайн" : "очно"}
      </Text>
      <Text variant="caption">
        {bookingStatusLabel(b.status)}
        {b.status === "confirmed" ? ` · ${PAYMENT_STATUS_LABELS[b.paymentStatus] ?? ""}` : ""}
      </Text>
      {b.pricePerSession !== null ? <Text variant="caption" muted>{b.pricePerSession} {b.currency}</Text> : null}
      {features.payments && canPay(b.status, b.paymentStatus) ? (
        <>
          <Button title="Оплатить" onPress={pay} loading={busy} />
          <Button title="Я оплатил(а), проверить" variant="secondary" onPress={check} disabled={busy} />
        </>
      ) : null}
      <ChatButton b={b} label="Чат с тренером" unread={unread} />
      {b.trainingId && b.status !== "cancelled" ? <Button title="Открыть тренировку" variant="secondary" onPress={() => router.push({ pathname: "/training/[id]", params: { id: b.trainingId! } })} /> : null}
      {b.isCompleted && !b.hasReview ? <Button title="Оставить отзыв" variant="secondary" onPress={() => setReviewing(true)} /> : null}
      <SessionConfirmation booking={b} side="athlete" onChange={onChanged} />
      <CancelBooking booking={b} side="athlete" onCancelled={onChanged} />
      <CancellationNote cancellation={b.cancellation} side="athlete" />
      <ReviewSheet
        visible={reviewing}
        title={`Отзыв о тренере ${b.coachFullName}`}
        hint="Оцените занятие и, если хотите, напишите пару слов — это поможет другим игрокам."
        submit={(input) => reviewBooking(b.id, input)}
        onClose={() => setReviewing(false)}
        onSubmitted={() => {
          setReviewing(false);
          onChanged();
        }}
      />
    </Card>
  );
}

function PendingRequest({ b, onChanged }: { b: PendingBooking; onChanged: () => void }) {
  const toast = useToast();

  async function decide(accept: boolean) {
    try {
      if (accept) await confirmBooking(b.id);
      else await declineBooking(b.id);
      onChanged();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="label">{b.athleteFullName}</Text>
      <Text muted>
        {b.listingTitle ?? "Занятие"} · {formatStart(b.startsAt)} · {b.durationMinutes} мин · {b.format === "online" ? "онлайн" : "очно"}
      </Text>
      {b.athleteRatingAverage !== null ? <Text variant="caption">Оценка спортсмена: ★ {b.athleteRatingAverage.toFixed(1)} ({b.athleteReviewCount})</Text> : null}
      {b.athleteNotes ? <Text>{b.athleteNotes}</Text> : null}
      <Button title="Профиль игрока и отзывы" variant="secondary" onPress={() => router.push({ pathname: "/player/[id]", params: { id: b.athleteUserId } })} />
      <Button title="Подтвердить" onPress={() => void decide(true)} />
      <Button title="Отклонить" variant="secondary" onPress={() => void decide(false)} />
    </Card>
  );
}

function CoachBooking({ b, onChanged, unread }: { b: Booking; onChanged: () => void; unread: number }) {
  const toast = useToast();

  async function decide(accept: boolean) {
    try {
      if (accept) await confirmBooking(b.id);
      else await declineBooking(b.id);
      onChanged();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="label">{b.athleteFullName}</Text>
      <Text muted>
        {b.listingTitle ?? "Занятие"} · {formatStart(b.startsAt)} · {b.durationMinutes} мин
      </Text>
      {b.athleteNotes ? <Text>{b.athleteNotes}</Text> : null}
      <Text variant="caption">
        {bookingStatusLabel(b.status)}
        {b.status === "confirmed" ? ` · ${PAYMENT_STATUS_LABELS[b.paymentStatus] ?? ""}` : ""}
      </Text>
      {b.status === "pending" ? (
        <>
          <Button title="Подтвердить" onPress={() => void decide(true)} />
          <Button title="Отклонить" variant="secondary" onPress={() => void decide(false)} />
        </>
      ) : null}
      <ChatButton b={b} label="Чат с игроком" unread={unread} />
      {b.status !== "cancelled" ? <CoachSessionActions booking={b} onChange={onChanged} /> : null}
      {b.status !== "cancelled" ? <PlanPicker booking={b} onChange={onChanged} /> : null}
      {b.trainingId && b.status !== "cancelled" ? <Button title="Открыть тренировку" variant="secondary" onPress={() => router.push({ pathname: "/training/[id]", params: { id: b.trainingId! } })} /> : null}
      <SessionConfirmation booking={b} side="coach" onChange={onChanged} />
      <CancelBooking booking={b} side="coach" onCancelled={onChanged} />
      <CancellationNote cancellation={b.cancellation} side="coach" />
      <Button title="Профиль игрока" variant="ghost" onPress={() => router.push({ pathname: "/player/[id]", params: { id: b.athleteUserId } })} />
    </Card>
  );
}

/** My sessions: as a player, the ones I booked (pay, review); as a coach, the requests to answer and the confirmed sessions. */
export default function BookingsScreen() {
  const { user } = useAuth();
  const chats = useChatUnread();
  const isCoach = user?.preferredRole === "coach";
  const data = useLoad(async () => {
    if (!isCoach) return { pending: [] as PendingBooking[], bookings: await listMyBookings() };
    const [pending, bookings] = await Promise.all([listCoachPendingBookings(), listCoachBookings()]);
    return { pending, bookings };
  }, [isCoach]);

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Нет данных"} onRetry={data.reload} />;
  const { pending, bookings } = data.data;
  const sorted = [...bookings].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  // A cancelled session is history: it moves to its own list, so the active ones stay in front.
  const items = sorted.filter((b) => b.status !== "cancelled");
  const cancelled = sorted.filter((b) => b.status === "cancelled");
  const card = (b: Booking) =>
    isCoach ? <CoachBooking key={b.id} b={b} onChanged={data.reload} unread={chats.booking[b.id] ?? 0} /> : <PlayerBooking key={b.id} b={b} onChanged={data.reload} unread={chats.booking[b.id] ?? 0} />;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: isCoach ? "Записи ко мне" : "Мои записи" }} />
      <Screen header>
        {!isCoach ? <Button title="Найти тренера" variant="secondary" onPress={() => router.push("/coaches")} /> : null}
        {pending.length > 0 ? <Text variant="heading">Новые заявки</Text> : null}
        {pending.map((b) => (
          <PendingRequest key={b.id} b={b} onChanged={data.reload} />
        ))}
        {pending.length > 0 && items.length > 0 ? <Text variant="heading">Записи</Text> : null}
        {items.length === 0 && cancelled.length === 0 && pending.length === 0 ? <Text muted>{isCoach ? "Записей пока нет." : "Вы ещё ни на что не записывались."}</Text> : null}
        {items.map(card)}
        {cancelled.length > 0 ? <Text variant="heading">Отменённые</Text> : null}
        {cancelled.map(card)}
      </Screen>
    </>
  );
}
