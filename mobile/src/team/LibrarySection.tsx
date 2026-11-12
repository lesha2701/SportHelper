import { router } from "expo-router";
import { useState } from "react";
import { listMyExercises, listTeamExercises, shareExercise, unshareExercise } from "@/api/exercises";
import { listMyPlans, listTeamPlans, sharePlan, unsharePlan } from "@/api/plans";
import { toFormError } from "@/lib/formError";
import { emptyLibraryText, libraryNoun, type LibraryKind } from "@/lib/teamLibrary";
import { useLoad } from "@/lib/useLoad";
import type { Team } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ListRow } from "@/ui/ListRow";
import { Notice } from "@/ui/Notice";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";

type Item = { id: string; name: string; sport: string; sharedTeamIds: string[] };

const KINDS: { value: LibraryKind; title: string }[] = [
  { value: "exercises", title: "Упражнения" },
  { value: "plans", title: "Планы" },
];

function open(kind: LibraryKind, id: string) {
  router.push(kind === "exercises" ? { pathname: "/library/exercise/[id]", params: { id } } : { pathname: "/library/plan/[id]", params: { id } });
}

/** «Упражнения и планы» of a team: what the coach opened to it (everyone reads it); the coach also opens more from here,
 * without going to the library. */
export function LibrarySection({ team, staff }: { team: Team; staff: boolean }) {
  const [kind, setKind] = useState<LibraryKind>("exercises");
  const [choosing, setChoosing] = useState(false);

  return (
    <>
      <Choice layout="chips" options={KINDS} value={kind} onChange={(next) => (setKind(next), setChoosing(false))} />
      {choosing ? (
        <ShareList key={kind} team={team} kind={kind} onDone={() => setChoosing(false)} />
      ) : (
        <TeamMaterials key={kind} team={team} kind={kind} staff={staff} onChoose={() => setChoosing(true)} />
      )}
    </>
  );
}

function TeamMaterials({ team, kind, staff, onChoose }: { team: Team; kind: LibraryKind; staff: boolean; onChoose: () => void }) {
  const items = useLoad<Item[]>(() => (kind === "exercises" ? listTeamExercises(team.id) : listTeamPlans(team.id)), [team.id, kind]);
  const empty = emptyLibraryText(kind, staff);

  if (items.loading && !items.data) return <LoadingView />;
  if (items.error && !items.data) return <ErrorView message={items.error} onRetry={items.reload} />;

  return (
    <>
      {staff ? <Button title={`Открыть команде ${libraryNoun(kind)}`} onPress={onChoose} /> : null}
      {items.data?.length === 0 ? (
        <Card>
          <Text variant="label">{empty.title}</Text>
          <Text muted>{empty.hint}</Text>
        </Card>
      ) : null}
      {items.data?.map((item) => (
        <ListRow key={item.id} title={item.name} subtitle={item.sport} onPress={() => open(kind, item.id)} />
      ))}
    </>
  );
}

/** The coach's own exercises or plans with a switch for each: open to this team or not. */
function ShareList({ team, kind, onDone }: { team: Team; kind: LibraryKind; onDone: () => void }) {
  const mine = useLoad<Item[]>(() => (kind === "exercises" ? listMyExercises() : listMyPlans()), [kind]);
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (mine.loading && !mine.data) return <LoadingView />;
  if (mine.error && !mine.data) return <ErrorView message={mine.error} onRetry={mine.reload} />;

  const isOn = (item: Item) => shared[item.id] ?? item.sharedTeamIds.includes(team.id);

  async function toggle(item: Item, on: boolean) {
    setBusy(item.id);
    setError(null);
    try {
      const updated =
        kind === "exercises"
          ? on ? await shareExercise(item.id, team.id) : await unshareExercise(item.id, team.id)
          : on ? await sharePlan(item.id, team.id) : await unsharePlan(item.id, team.id);
      setShared((current) => ({ ...current, [item.id]: updated.sharedTeamIds.includes(team.id) }));
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <Text variant="heading">{kind === "exercises" ? "Открыть команде упражнения" : "Открыть команде планы"}</Text>
      <Text variant="caption" muted>
        Включённое увидят все участники команды «{team.name}» в разделе «Упражнения и планы».
      </Text>
      {mine.data?.length === 0 ? <Text muted>В вашей библиотеке пока нет {kind === "exercises" ? "упражнений" : "планов"}. Создайте их во вкладке «Библиотека».</Text> : null}
      {mine.data?.map((item) => (
        <SwitchRow key={item.id} label={item.name} value={isOn(item)} onChange={(on) => busy === null && void toggle(item, on)} />
      ))}
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Готово" variant="secondary" onPress={onDone} />
    </Card>
  );
}
