import { View } from "react-native";
import { getTeamStats } from "@/api/stats";
import { useLoad } from "@/lib/useLoad";
import { formatRate } from "@/shared/types/stats";
import type { Team } from "@/shared/types/team";
import { Card } from "@/ui/Card";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { StatGrid, StatTile } from "@/ui/StatTile";
import { Text } from "@/ui/Text";

export function StatsSection({ team }: { team: Team }) {
  const stats = useLoad(() => getTeamStats(team.id), [team.id]);
  if (stats.loading && !stats.data) return <LoadingView />;
  if (stats.error || !stats.data) return <ErrorView message={stats.error ?? "Нет данных"} onRetry={stats.reload} />;
  const s = stats.data;
  return (
    <>
      <StatGrid>
        <StatTile value={s.membersCount} label="участников" />
        <StatTile value={formatRate(s.attendanceRate)} label="посещаемость" />
        <StatTile value={s.trainingsCompleted} label="тренировок проведено" />
        <StatTile value={s.trainingsUpcoming} label="впереди" />
        <StatTile value={`${s.tasksCompleted}/${s.tasksTotal}`} label="заданий выполнено" />
        <StatTile value={s.tasksOverdue} label="просрочено" />
        <StatTile value={`${s.matchesWon}-${s.matchesDrawn}-${s.matchesLost}`} label="матчи: победы-ничьи-поражения" />
        <StatTile value={s.avgWellbeing === null ? "—" : s.avgWellbeing.toFixed(1)} label="самочувствие (1–5)" />
      </StatGrid>
      {s.lowActivityPlayers.length > 0 ? (
        <Card>
          <Text variant="heading">Низкая активность</Text>
          {s.lowActivityPlayers.map((p) => (
            <View key={p.userId}>
              <Text>{[p.firstName, p.lastName].filter(Boolean).join(" ")}</Text>
              <Text variant="caption" muted>
                Посещаемость {formatRate(p.attendanceRate)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {s.frequentAbsencePlayers.length > 0 ? (
        <Card>
          <Text variant="heading">Частые пропуски</Text>
          {s.frequentAbsencePlayers.map((p) => (
            <Text key={p.userId}>
              {[p.firstName, p.lastName].filter(Boolean).join(" ")} · пропусков: {p.absentCount}
            </Text>
          ))}
        </Card>
      ) : null}
    </>
  );
}
