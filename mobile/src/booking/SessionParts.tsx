import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { analyzePersonalTrainingPlayer, getPersonalTrainingPlayerAnalysis, type PlayerPreSessionAnalysis } from "@/api/ai";
import { completeBookingSession, getCoachBookingByTraining, listMyBookings, reviewBooking, reviewPlayer, setBookingPlan } from "@/api/bookings";
import { ApiError } from "@/api/client";
import { listMyPlans } from "@/api/plans";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import type { Booking, ReviewInput } from "@/shared/types/booking";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ListRow } from "@/ui/ListRow";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Stars and a few words, in a sheet (the website's ReviewModal). */
export function ReviewSheet({
  visible,
  title,
  hint,
  skipLabel = "Отмена",
  submit,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  title: string;
  hint: string;
  skipLabel?: string;
  submit: (input: ReviewInput) => Promise<void>;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { colors } = useTheme();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!rating) return setError("Поставьте оценку — от 1 до 5 звёзд.");
    setBusy(true);
    try {
      await submit({ rating, text: text.trim() || null });
      setRating(0);
      setText("");
      onSubmitted();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <Text muted>{hint}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} из 5`}
            hitSlop={4}
            onPress={() => {
              setRating(n);
              setError(null);
            }}
          >
            <Ionicons name={n <= rating ? "star" : "star-outline"} size={34} color={n <= rating ? colors.warning : colors.textTertiary} />
          </Pressable>
        ))}
      </View>
      <TextField label="Комментарий (необязательно)" value={text} onChangeText={setText} multiline numberOfLines={3} maxLength={1000} />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Отправить отзыв" onPress={send} loading={busy} />
      <Button title={skipLabel} variant="ghost" onPress={onClose} />
    </BottomSheet>
  );
}

/** The coach's actions on a confirmed booked session: «Тренировка проведена» (which then offers the review of the
 * player right away) and the review of the player later. */
export function CoachSessionActions({ booking, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [now] = useState(() => Date.now());
  if (booking.status !== "confirmed" || booking.trainingStatus === "cancelled") return null;

  const started = new Date(booking.startsAt).getTime() <= now;
  const canMarkConducted = booking.trainingStatus === "scheduled" && started;
  const canReview = booking.isCompleted && !booking.hasPlayerReview && !canMarkConducted;

  async function markConducted() {
    setBusy(true);
    try {
      const updated = await completeBookingSession(booking.id);
      onChange(updated);
      if (!updated.hasPlayerReview) setReviewOpen(true);
    } catch {
      // the API layer already showed why
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {canMarkConducted ? (
        <>
          <Button title="Тренировка проведена" onPress={markConducted} loading={busy} />
          <Text variant="caption" muted>
            После отметки игрок получит просьбу оценить вас, а вы сможете оставить отзыв об игроке.
          </Text>
        </>
      ) : null}
      {!canMarkConducted && booking.trainingStatus === "scheduled" && !started ? (
        <Text variant="caption" muted>
          Кнопка «Тренировка проведена» появится, когда занятие начнётся.
        </Text>
      ) : null}
      {canReview ? <Button title="Оставить отзыв об игроке" variant="secondary" onPress={() => setReviewOpen(true)} /> : null}
      {booking.hasPlayerReview ? <Text muted>✓ Вы оставили отзыв об игроке</Text> : null}
      <ReviewSheet
        visible={reviewOpen}
        title={`Отзыв: ${booking.athleteFullName}`}
        hint="Отзыв увидят другие тренеры, когда этот игрок запишется к ним. Пишите по делу и по фактам."
        skipLabel="Позже"
        submit={(input) => reviewPlayer(booking.id, input)}
        onClose={() => setReviewOpen(false)}
        onSubmitted={() => {
          setReviewOpen(false);
          onChange({ ...booking, hasPlayerReview: true, isCompleted: true });
        }}
      />
    </View>
  );
}

/** The coach picks one of their library plans for a booked session; the athlete sees it on the training. */
export function PlanPicker({ booking, onChange }: { booking: Booking; onChange: (b: Booking) => void }) {
  const [open, setOpen] = useState(false);
  const plans = useLoad(async () => (open ? listMyPlans() : []), [open]);
  const [error, setError] = useState<string | null>(null);
  if (booking.status !== "confirmed" || booking.trainingStatus !== "scheduled") return null;

  async function choose(planId: string | null) {
    try {
      onChange(await setBookingPlan(booking.id, planId));
      setOpen(false);
    } catch (e) {
      setError(toFormError(e).message);
    }
  }

  return (
    <>
      <ListRow
        icon="book-outline"
        title={booking.trainingPlanName ? `План: ${booking.trainingPlanName}` : "Выбрать план занятия"}
        subtitle="Из вашей библиотеки — игрок увидит его в тренировке"
        onPress={() => setOpen(true)}
      />
      <BottomSheet visible={open} title={`План для ${booking.athleteFullName}`} onClose={() => setOpen(false)}>
        {plans.loading ? <Text muted>Загрузка планов…</Text> : null}
        {plans.data && plans.data.length === 0 && !plans.loading ? <Text muted>У вас пока нет сохранённых планов в Библиотеке.</Text> : null}
        {plans.data?.map((p) => (
          <ListRow key={p.id} icon={p.id === booking.trainingPlanId ? "checkmark-circle" : "book-outline"} title={p.name} onPress={() => void choose(p.id)} />
        ))}
        {booking.trainingPlanId ? <Button title="Убрать план" variant="ghost" onPress={() => void choose(null)} /> : null}
        {error ? <Notice kind="danger">{error}</Notice> : null}
      </BottomSheet>
    </>
  );
}

/** On a booked personal training, the coach's part: session actions, the plan, the player's profile. Nothing if
 * there is no booking of theirs behind it. */
export function CoachSessionCard({ trainingId, onChanged }: { trainingId: string; onChanged?: () => void }) {
  const loaded = useLoad(() => getCoachBookingByTraining(trainingId).catch(() => null), [trainingId]);
  const [override, setOverride] = useState<Booking | null>(null);
  const booking = override ?? loaded.data ?? null;
  if (!booking) return null;
  return (
    <Card>
      <Text variant="heading">Занятие с {booking.athleteFullName}</Text>
      <CoachSessionActions
        booking={booking}
        onChange={(b) => {
          setOverride(b);
          onChanged?.();
        }}
      />
      <PlanPicker
        booking={booking}
        onChange={(b) => {
          setOverride(b);
          onChanged?.();
        }}
      />
      <Button title="Профиль игрока" variant="secondary" onPress={() => router.push({ pathname: "/player/[id]", params: { id: booking.athleteUserId } })} />
    </Card>
  );
}

/** On the athlete's own booked training: once it is conducted, the review of the coach is right here. */
export function AthleteSessionCard({ trainingId }: { trainingId: string }) {
  const loaded = useLoad(async () => (await listMyBookings()).find((b) => b.trainingId === trainingId) ?? null, [trainingId]);
  const [reviewed, setReviewed] = useState(false);
  const [open, setOpen] = useState(false);
  const booking = loaded.data;
  if (!booking || booking.status !== "confirmed") return null;
  const hasReview = booking.hasReview || reviewed;
  return (
    <Card>
      <Text variant="heading">Занятие с тренером {booking.coachFullName}</Text>
      {booking.isCompleted && !hasReview ? (
        <>
          <Text muted>Занятие прошло. Оцените тренера — это поможет другим игрокам.</Text>
          <Button title="Оставить отзыв" onPress={() => setOpen(true)} />
        </>
      ) : null}
      {hasReview ? <Text muted>✓ Вы оставили отзыв о тренере</Text> : null}
      {!booking.isCompleted ? <Text muted>Отзыв можно оставить после занятия — когда тренер отметит его проведённым или когда пройдёт время занятия.</Text> : null}
      <ReviewSheet
        visible={open}
        title={`Отзыв о тренере ${booking.coachFullName}`}
        hint="Оцените занятие и, если хотите, напишите пару слов — это поможет другим игрокам."
        submit={(input) => reviewBooking(booking.id, input)}
        onClose={() => setOpen(false)}
        onSubmitted={() => {
          setOpen(false);
          setReviewed(true);
        }}
      />
    </Card>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text variant="label">{title}</Text>
      {items.map((item, i) => (
        <Text key={i}>• {item}</Text>
      ))}
    </View>
  );
}

function AnalysisResult({ a }: { a: PlayerPreSessionAnalysis }) {
  const { colors } = useTheme();
  const generated = new Date(a.generatedAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
  return (
    <View style={{ gap: 12 }}>
      {a.dataSufficiency !== "sufficient" || a.dataNotes ? (
        <Notice kind="info">
          {a.dataSufficiency === "insufficient"
            ? "Недостаточно данных: об игроке почти ничего не известно, поэтому рекомендации общие."
            : a.dataSufficiency === "limited"
              ? "Данных об игроке пока немного — выводы осторожные."
              : ""}
          {a.dataNotes ? ` ${a.dataNotes}` : ""}
        </Notice>
      ) : null}
      {a.summary ? (
        <View style={{ gap: 4 }}>
          <Text variant="label">Краткий анализ игрока</Text>
          <Text>{a.summary}</Text>
        </View>
      ) : null}
      <Bullets title="Сильные стороны" items={a.strengths} />
      <Bullets title="На что стоит обратить внимание" items={a.attentionPoints} />
      <Bullets title="Последняя динамика" items={a.recentDynamics} />
      <Bullets title="Рекомендации к предстоящей тренировке" items={a.recommendations} />
      {a.sessionFocus ? (
        <View style={{ gap: 4 }}>
          <Text variant="label">Предлагаемый акцент занятия</Text>
          <Text>{a.sessionFocus}</Text>
        </View>
      ) : null}
      {a.sessionPlan.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text variant="label">Возможная структура занятия</Text>
          {a.sessionPlan.map((s, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text>
                {i + 1}. <Text variant="label">{s.stage}.</Text> {s.description}
              </Text>
              {s.exerciseName ? (
                <View style={[styles.libBadge, { backgroundColor: colors.primaryGlow }]}>
                  <Ionicons name="book-outline" size={12} color={colors.primary} />
                  <Text variant="caption" style={{ color: colors.primary }}>
                    Из вашей библиотеки: {s.exerciseName}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="caption" muted>
        Сформировано {generated}. Это подсказка на основе доступных данных, а не окончательная характеристика игрока.
      </Text>
    </View>
  );
}

/** The coach's «prepare for the session»: AI analysis of the booked player, if the player allowed it. */
export function PlayerAiAnalysisCard({ trainingId }: { trainingId: string }) {
  const { colors } = useTheme();
  const status = useLoad(() => getPersonalTrainingPlayerAnalysis(trainingId), [trainingId]);
  const [result, setResult] = useState<PlayerPreSessionAnalysis | null>(null);
  const [denied, setDenied] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status.loading && !status.data) return null;
  if (status.error && !status.data) {
    return (
      <Card>
        <Text variant="heading">AI-анализ игрока</Text>
        <Notice kind="danger">{status.error}</Notice>
        <Button title="Повторить" variant="secondary" onPress={status.reload} />
      </Card>
    );
  }
  if (denied || (status.data && !status.data.allowed)) {
    return (
      <Card>
        <View style={styles.head}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
          <Text variant="heading">AI-анализ недоступен</Text>
        </View>
        <Text muted>Игрок не разрешил использовать свои спортивные данные для AI-анализа.</Text>
      </Card>
    );
  }
  const analysis = result ?? status.data?.analysis ?? null;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await analyzePersonalTrainingPlayer(trainingId));
    } catch (e) {
      if (e instanceof ApiError && e.code === "player_ai_analysis_disabled") setDenied(true);
      else setError(toFormError(e).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <View style={styles.head}>
        <Ionicons name="sparkles" size={18} color={colors.primary} />
        <Text variant="heading">AI-анализ игрока</Text>
      </View>
      <Text muted>AI изучит доступные данные игрока и поможет подготовиться к предстоящей тренировке.</Text>
      {running ? <Text muted>Анализирую данные игрока — это может занять до минуты…</Text> : null}
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title={analysis ? "Обновить анализ" : "Проанализировать игрока"} onPress={run} loading={running} />
      {analysis ? <AnalysisResult a={analysis} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  libBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
});
