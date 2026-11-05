import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { searchAll, type SearchResult, type SearchResultType } from "@/api/search";
import { toFormError } from "@/lib/formError";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const TYPE_LABELS: Record<SearchResultType, string> = {
  team: "Команда",
  player: "Игрок",
  coach: "Тренер",
  exercise: "Упражнение",
  training: "Тренировка",
  match: "Матч",
  task: "Задание",
};

function open(r: SearchResult) {
  if (r.type === "team") router.push({ pathname: "/team/[id]", params: { id: r.id } });
  else if (r.type === "training") router.push({ pathname: "/training/[id]", params: { id: r.id } });
  else if (r.type === "match") router.push({ pathname: "/match/[id]", params: { id: r.id } });
  else if (r.type === "task") router.push({ pathname: "/task/[id]", params: { id: r.id } });
  else if (r.type === "coach") router.push({ pathname: "/coach/[id]", params: { id: r.id } });
  else if (r.type === "exercise") router.push({ pathname: "/library/exercise/[id]", params: { id: r.id } });
}

/** One search over teams, people, exercises, trainings, matches and tasks. */
export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Searches a moment after typing stops, and ignores answers to an older query.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      searchAll(text)
        .then((found) => current && (setResults(found), setError(null)))
        .catch((e: unknown) => current && setError(toFormError(e).message));
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Поиск" }} />
      <Screen header>
        <TextField label="Что искать" value={query} onChangeText={setQuery} autoFocus placeholder="Команда, игрок, упражнение…" />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        {results?.length === 0 ? <Text muted>Ничего не найдено.</Text> : null}
        {results?.map((r) => (
          <Card key={`${r.type}-${r.id}`} onPress={() => open(r)}>
            <Text variant="caption" muted>
              {TYPE_LABELS[r.type]}
            </Text>
            <Text variant="label">{r.title}</Text>
            {r.subtitle ? <Text muted>{r.subtitle}</Text> : null}
          </Card>
        ))}
      </Screen>
    </>
  );
}
