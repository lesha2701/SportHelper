import { Stack, router } from "expo-router";
import { useState } from "react";
import { confirmBooking, declineBooking, listCoachBookings, listCoachPendingBookings, listMyBookings, reviewBooking } from "@/api/bookings";
import { openPaymentPage, startBookingPayment, syncBookingPayment } from "@/api/payments";
import { useAuth } from "@/auth/AuthProvider";
import { useFeatures } from "@/lib/useFeatures";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS, canPay, formatStart } from "@/shared/lib/bookingLabels";
import type { Booking, PendingBooking } from "@/shared/types/booking";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

const STARS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), title: "★".repeat(n) }));

function ReviewForm({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const [rating, setRating] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!rating) return setError("Поставьте оценку.");
    setBusy(true);
    try {
      await reviewBooking(booking.id, { rating: Number(rating), text: text.trim() || null });
      onDone();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Choice label="Оцените занятие" layout="chips" options={STARS} value={rating} onChange={setRating} />
      <TextField label="Отзыв" value={text} onChangeText={setText} multiline numberOfLines={3} maxLength={1000} />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Отправить отзыв" onPress={send} loading={busy} />
    </>
  );
}

function PlayerBooking({ b, onChanged }: { b: Booking; onChanged: () => void }) {
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
        {BOOKING_STATUS_LABELS[b.status]}
        {b.status === "confirmed" ? ` · ${PAYMENT_STATUS_LABELS[b.paymentStatus]}` : ""}
      </Text>
      {b.pricePerSession !== null ? <Text variant="caption" muted>{b.pricePerSession} {b.currency}</Text> : null}
      {features.payments && canPay(b.status, b.paymentStatus) ? (
        <>
          <Button title="Оплатить" onPress={pay} loading={busy} />
          <Button title="Я оплатил(а), проверить" variant="secondary" onPress={check} disabled={busy} />
        </>
      ) : null}
      {b.trainingId ? <Button title="Открыть тренировку" variant="secondary" onPress={() => router.push({ pathname: "/training/[id]", params: { id: b.trainingId! } })} /> : null}
      {b.isCompleted && !b.hasReview ? (
        reviewing ? <ReviewForm booking={b} onDone={onChanged} /> : <Button title="Оставить отзыв" variant="secondary" onPress={() => setReviewing(true)} />
      ) : null}
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
      <Button title="Подтвердить" onPress={() => void decide(true)} />
      <Button title="Отклонить" variant="secondary" onPress={() => void decide(false)} />
    </Card>
  );
}

function CoachBooking({ b, onChanged }: { b: Booking; onChanged: () => void }) {
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
        {BOOKING_STATUS_LABELS[b.status]}
        {b.status === "confirmed" ? ` · ${PAYMENT_STATUS_LABELS[b.paymentStatus]}` : ""}
      </Text>
      {b.status === "pending" ? (
        <>
          <Button title="Подтвердить" onPress={() => void decide(true)} />
          <Button title="Отклонить" variant="secondary" onPress={() => void decide(false)} />
        </>
      ) : null}
      {b.trainingId ? <Button title="Открыть тренировку" variant="secondary" onPress={() => router.push({ pathname: "/training/[id]", params: { id: b.trainingId! } })} /> : null}
    </Card>
  );
}

/** My sessions: as a player, the ones I booked (pay, review); as a coach, the requests to answer and the confirmed sessions. */
export default function BookingsScreen() {
  const { user } = useAuth();
  const isCoach = user?.preferredRole === "coach";
  const data = useLoad(async () => {
    if (!isCoach) return { pending: [] as PendingBooking[], bookings: await listMyBookings() };
    const [pending, bookings] = await Promise.all([listCoachPendingBookings(), listCoachBookings()]);
    return { pending, bookings };
  }, [isCoach]);

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Нет данных"} onRetry={data.reload} />;
  const { pending, bookings } = data.data;
  const items = [...bookings].sort((a, b) => b.startsAt.localeCompare(a.startsAt));

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
        {items.length === 0 && pending.length === 0 ? <Text muted>{isCoach ? "Записей пока нет." : "Вы ещё ни на что не записывались."}</Text> : null}
        {items.map((b) => (isCoach ? <CoachBooking key={b.id} b={b} onChanged={data.reload} /> : <PlayerBooking key={b.id} b={b} onChanged={data.reload} />))}
      </Screen>
    </>
  );
}
