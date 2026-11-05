import { Stack, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { deleteMetric } from "@/api/metrics";
import { getProgressAnalysis } from "@/api/ai";
import { getPlayerStats } from "@/api/stats";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { formatRuDate } from "@/shared/lib/dates";
import { MATCH_RESULT_LABELS } from "@/shared/types/match";
import { formatRate } from "@/shared/types/stats";
import { AiText } from "@/ui/AiText";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { StatGrid, StatTile } from "@/ui/StatTile";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

function matchResult(ours: number | null, theirs: number | null): string {
  if (ours === null || theirs === null) return "";
  return ours > theirs ? MATCH_RESULT_LABELS.win : ours < theirs ? MATCH_RESULT_LABELS.loss : MATCH_RESULT_LABELS.draw;
}

/** The signed-in player's own statistics: attendance, tasks, matches, personal records and measurements. */
export default function StatsScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const stats = useLoad(() => getPlayerStats(user!.id), [user?.id]);
  const [removing, setRemoving] = useState<string | null>(null);

  if (stats.loading && !stats.data) return <LoadingView />;
  if (stats.error || !stats.data) return <ErrorView message={stats.error ?? "Нет данных"} onRetry={stats.reload} />;
  const s = stats.data;

  async function remove(id: string) {
    setRemoving(null);
    try {
      await deleteMetric(id);
      stats.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Моя статистика" }} />
      <Screen header>
        <StatGrid>
          <StatTile value={formatRate(s.attendanceRate)} label="посещаемость" />
          <StatTile value={`${s.trainingsAttended}/${s.trainingsTotal}`} label="тренировок" />
          <StatTile value={Math.round(s.trainingMinutes / 60)} label="часов тренировок" />
          <StatTile value={s.activityStreak} label="дней подряд" />
          <StatTile value={`${s.tasksCompleted}/${s.tasksTotal}`} label="заданий выполнено" />
          <StatTile value={s.tasksOverdue} label="просрочено" />
        </StatGrid>

        <AiText title="Анализ прогресса (ИИ)" heading="Анализ прогресса" load={getProgressAnalysis} />

        {s.personalRecords.length > 0 ? (
          <Card>
            <Text variant="heading">Личные рекорды</Text>
            {s.personalRecords.map((r) => (
              <View key={r.name}>
                <Text variant="label">{r.name}</Text>
                <Text muted>
                  {r.value}
                  {r.unit ? ` ${r.unit}` : ""} · {formatRuDate(r.recordedDate)}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Text variant="heading">Показатели</Text>
          {s.metrics.length === 0 ? <Text muted>Здесь будут ваши замеры: вес, время на дистанции, жим и другое.</Text> : null}
          {s.metrics.map((m) => (
            <View key={m.id} style={{ gap: 2 }}>
              <Text variant="label">
                {m.name}: {m.value}
                {m.unit ? ` ${m.unit}` : ""}
              </Text>
              <Text variant="caption" muted>
                {formatRuDate(m.recordedDate)}
                {m.comment ? ` · ${m.comment}` : ""}
              </Text>
              <Button title="Удалить" variant="ghost" onPress={() => setRemoving(m.id)} />
            </View>
          ))}
          <Button title="Добавить показатель" variant="secondary" onPress={() => router.push({ pathname: "/metric-new", params: { userId: user!.id } })} />
        </Card>

        {s.matchesHistory.length > 0 ? (
          <Card>
            <Text variant="heading">Матчи</Text>
            {s.matchesHistory.map((m) => (
              <Text key={m.id}>
                {formatRuDate(m.matchDate)} · {m.opponentName}
                {m.ourScore !== null ? ` · ${m.ourScore}:${m.opponentScore} ${matchResult(m.ourScore, m.opponentScore)}` : ""}
              </Text>
            ))}
          </Card>
        ) : null}

        {s.coachComments.length > 0 ? (
          <Card>
            <Text variant="heading">Комментарии тренера</Text>
            {s.coachComments.map((c, i) => (
              <View key={i}>
                <Text>{c.comment}</Text>
                <Text variant="caption" muted>
                  {c.context}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        <ConfirmModal visible={removing !== null} title="Удалить показатель?" confirmLabel="Удалить" destructive onCancel={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
      </Screen>
    </>
  );
}
