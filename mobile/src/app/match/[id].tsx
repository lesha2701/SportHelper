import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { deleteMatch, getMatch, setMatchResult, setMatchRoster } from "@/api/matches";
import { getTeam, listMembers } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { formatDayTitle, shortTime } from "@/shared/lib/dates";
import { MATCH_RESULT_LABELS, MATCH_STATUS_LABELS, type Match } from "@/shared/types/match";
import type { TeamMember } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Checkbox } from "@/ui/Checkbox";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

function Roster({ match, members, onSaved }: { match: Match; members: TeamMember[]; onSaved: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(match.roster.map((r) => r.userId));
  const [busy, setBusy] = useState(false);
  const players = members.filter((m) => m.role !== "head_coach" && m.role !== "assistant_coach");

  async function save() {
    setBusy(true);
    try {
      await setMatchRoster(match.id, { user_ids: picked });
      onSaved();
    } catch (e) {
      toast.error(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Состав на матч</Text>
      {players.map((m) => (
        <Checkbox
          key={m.userId}
          checked={picked.includes(m.userId)}
          onChange={(on) => setPicked((current) => (on ? [...current, m.userId] : current.filter((id) => id !== m.userId)))}
        >
          <Text>{[m.firstName, m.lastName].filter(Boolean).join(" ")}</Text>
        </Checkbox>
      ))}
      <Button title="Сохранить состав" variant="secondary" onPress={save} loading={busy} />
    </Card>
  );
}

function ResultForm({ match, onSaved }: { match: Match; onSaved: () => void }) {
  const [ours, setOurs] = useState(match.ourScore?.toString() ?? "");
  const [theirs, setTheirs] = useState(match.opponentScore?.toString() ?? "");
  const [comment, setComment] = useState(match.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const a = parseInt(ours, 10);
    const b = parseInt(theirs, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return setError("Введите счёт обеих команд.");
    setBusy(true);
    setError(null);
    try {
      await setMatchResult(match.id, { our_score: a, opponent_score: b, comment: comment.trim() || null });
      onSaved();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Итог матча</Text>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <TextField label="Наши" value={ours} onChangeText={setOurs} keyboardType="number-pad" maxLength={3} />
      <TextField label="Соперник" value={theirs} onChangeText={setTheirs} keyboardType="number-pad" maxLength={3} />
      <TextField label="Комментарий" value={comment} onChangeText={setComment} multiline numberOfLines={3} maxLength={1000} />
      <Button title="Сохранить итог" onPress={save} loading={busy} />
    </Card>
  );
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const loaded = useLoad(async () => {
    const match = await getMatch(id);
    const [team, members] = await Promise.all([getTeam(match.teamId), listMembers(match.teamId)]);
    return { match, team, members };
  }, [id]);
  const [deleting, setDeleting] = useState(false);

  if (loaded.loading && !loaded.data) return <LoadingView />;
  if (loaded.error || !loaded.data) return <ErrorView message={loaded.error ?? "Матч не найден"} onRetry={loaded.reload} />;
  const { match, team, members } = loaded.data;
  const staff = team.myRole === "head_coach" || team.myRole === "assistant_coach";

  async function remove() {
    setDeleting(false);
    try {
      await deleteMatch(match.id);
      router.back();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Матч" }} />
      <Screen header>
        <Text variant="title">{match.isHome ? "Дома" : "В гостях"}: {match.opponentName}</Text>
        <Card>
          <Text variant="heading">
            {formatDayTitle(match.matchDate)}, {shortTime(match.startTime)}
          </Text>
          <Text muted>{[team.name, match.location, match.tournament, MATCH_STATUS_LABELS[match.status]].filter(Boolean).join(" · ")}</Text>
          {match.ourScore !== null ? (
            <Text variant="title">
              {match.ourScore}:{match.opponentScore}
              {match.result ? ` · ${MATCH_RESULT_LABELS[match.result]}` : ""}
            </Text>
          ) : null}
          {match.comment ? <Text>{match.comment}</Text> : null}
        </Card>

        {staff ? (
          <>
            <Roster match={match} members={members} onSaved={loaded.reload} />
            <ResultForm match={match} onSaved={loaded.reload} />
            <Button title="Удалить матч" variant="ghost" onPress={() => setDeleting(true)} />
          </>
        ) : (
          <Card>
            <Text variant="heading">Состав</Text>
            {match.roster.length === 0 ? <Text muted>Состав ещё не объявлен.</Text> : null}
            {match.roster.map((r) => (
              <Text key={r.userId}>{[r.firstName, r.lastName].filter(Boolean).join(" ")}</Text>
            ))}
          </Card>
        )}
        <ConfirmModal visible={deleting} title="Удалить матч?" confirmLabel="Удалить" destructive onCancel={() => setDeleting(false)} onConfirm={() => void remove()} />
      </Screen>
    </>
  );
}
