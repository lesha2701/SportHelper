import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { listMyExercises } from "@/api/exercises";
import { listMyPlans } from "@/api/plans";
import { listMyTemplates } from "@/api/taskTemplates";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

type Tab = "exercises" | "plans" | "templates";

function Exercises() {
  const list = useLoad(listMyExercises);
  const reload = list.reload;
  // The tab stays mounted: show what was just created or edited.
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;
  return (
    <>
      <Button title="Новое упражнение" onPress={() => router.push("/library/exercise/new")} />
      {list.data?.length === 0 ? <Text muted>Упражнений пока нет. Добавьте первое: из них собираются планы тренировок.</Text> : null}
      {list.data?.map((e) => (
        <Card key={e.id} onPress={() => router.push({ pathname: "/library/exercise/[id]", params: { id: e.id } })}>
          <Text variant="label">{e.name}</Text>
          <Text muted>{[e.sport, e.sets && e.reps ? `${e.sets}×${e.reps}` : null, e.equipment].filter(Boolean).join(" · ")}</Text>
        </Card>
      ))}
    </>
  );
}

function Plans() {
  const list = useLoad(listMyPlans);
  const reload = list.reload;
  // The tab stays mounted: show what was just created or edited.
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;
  return (
    <>
      <Button title="Новый план" onPress={() => router.push("/library/plan/new")} />
      {list.data?.length === 0 ? <Text muted>Планов пока нет.</Text> : null}
      {list.data?.map((p) => (
        <Card key={p.id} onPress={() => router.push({ pathname: "/library/plan/[id]", params: { id: p.id } })}>
          <Text variant="label">{p.name}</Text>
          <Text muted>{[p.sport, `упражнений: ${p.exercises.length}`, p.durationMinutes ? `${p.durationMinutes} мин` : null].filter(Boolean).join(" · ")}</Text>
        </Card>
      ))}
    </>
  );
}

function Templates() {
  const list = useLoad(listMyTemplates);
  const reload = list.reload;
  // The tab stays mounted: show what was just created or edited.
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;
  return (
    <>
      <Button title="Новый шаблон" onPress={() => router.push("/library/template/new")} />
      {list.data?.length === 0 ? <Text muted>Шаблонов пока нет. Из шаблона задание создаётся в один шаг.</Text> : null}
      {list.data?.map((t) => (
        <Card key={t.id} onPress={() => router.push({ pathname: "/library/template/[id]", params: { id: t.id } })}>
          <Text variant="label">{t.title}</Text>
          {t.description ? <Text muted numberOfLines={2}>{t.description}</Text> : null}
        </Card>
      ))}
    </>
  );
}

/** The coach's library (a main tab for coaches): exercises, plans built from them, and task templates. */
export default function LibraryScreen() {
  const [tab, setTab] = useState<Tab>("exercises");
  return (
    <>
      <Screen header>
        <Choice
          layout="chips"
          options={[
            { value: "exercises", title: "Упражнения" },
            { value: "plans", title: "Планы" },
            { value: "templates", title: "Шаблоны" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "exercises" ? <Exercises /> : tab === "plans" ? <Plans /> : <Templates />}
      </Screen>
    </>
  );
}
