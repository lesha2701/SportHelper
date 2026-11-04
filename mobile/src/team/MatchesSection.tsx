import { router } from "expo-router";
import { listTeamMatches } from "@/api/matches";
import { useLoad } from "@/lib/useLoad";
import { formatDayTitle, shortTime } from "@/shared/lib/dates";
import { MATCH_RESULT_LABELS, MATCH_STATUS_LABELS } from "@/shared/types/match";
import type { Team } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

export function MatchesSection({ team, staff }: { team: Team; staff: boolean }) {
  const matches = useLoad(() => listTeamMatches(team.id), [team.id]);
  if (matches.loading && !matches.data) return <LoadingView />;
  if (matches.error && !matches.data) return <ErrorView message={matches.error} onRetry={matches.reload} />;

  const sorted = [...(matches.data ?? [])].sort((a, b) => (b.matchDate + b.startTime).localeCompare(a.matchDate + a.startTime));
  return (
    <>
      {staff ? <Button title="Новый матч" onPress={() => router.push({ pathname: "/match/new", params: { teamId: team.id } })} /> : null}
      {sorted.length === 0 ? <Text muted>Матчей пока нет.</Text> : null}
      {sorted.map((m) => (
        <Card key={m.id} onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id, teamId: team.id } })}>
          <Text variant="label">
            {m.isHome ? "Дома" : "В гостях"}: {m.opponentName}
          </Text>
          <Text muted>
            {formatDayTitle(m.matchDate)}, {shortTime(m.startTime)}
          </Text>
          <Text variant="caption">
            {m.status === "completed" && m.ourScore !== null
              ? `${m.ourScore}:${m.opponentScore}${m.result ? ` · ${MATCH_RESULT_LABELS[m.result]}` : ""}`
              : MATCH_STATUS_LABELS[m.status]}
          </Text>
        </Card>
      ))}
    </>
  );
}
