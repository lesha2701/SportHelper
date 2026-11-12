import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { createTeam, getTeam, updateTeam } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { MAX_TOURNAMENTS, MAX_TOURNAMENT_NAME, joinTournamentLines, parseTournamentLines } from "@/lib/tournaments";
import { COMMON_SPORTS, SKILL_LEVEL_LABELS, type SkillLevel } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const LEVELS = (Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]).map((value) => ({ value, title: SKILL_LEVEL_LABELS[value] }));

export default function NewTeamScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState<SkillLevel | null>(null);
  // One tournament per line; the match form offers them, and a home match takes the home venue as its place.
  const [tournaments, setTournaments] = useState("");
  const [homeVenue, setHomeVenue] = useState("");
  const [errors, setErrors] = useState<{ name?: string; sport?: string; tournaments?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTeam(id)
      .then((t) => {
        setName(t.name);
        setSport(t.sport);
        setDescription(t.description ?? "");
        setAge(t.ageCategory ?? "");
        setLevel(t.level);
        setTournaments(joinTournamentLines(t.tournaments));
        setHomeVenue(t.homeVenue ?? "");
      })
      .catch((e: unknown) => setLoadError(toFormError(e).message));
  }, [id]);

  async function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Укажите название.";
    if (!sport) found.sport = "Выберите вид спорта.";
    const tournamentNames = parseTournamentLines(tournaments);
    if (tournamentNames.length > MAX_TOURNAMENTS) found.tournaments = `Не больше ${MAX_TOURNAMENTS} турниров.`;
    else if (tournamentNames.some((n) => n.length > MAX_TOURNAMENT_NAME)) found.tournaments = `Название турнира не длиннее ${MAX_TOURNAMENT_NAME} знаков.`;
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (editing) {
        await updateTeam(id!, {
          name: name.trim(),
          sport,
          description: description.trim() || null,
          age_category: age.trim() || null,
          level,
          tournaments: tournamentNames,
          home_venue: homeVenue.trim() || null,
        });
        router.back();
        return;
      }
      const team = await createTeam({
        name: name.trim(),
        sport,
        description: description.trim() || null,
        age_category: age.trim() || null,
        level,
        tournaments: tournamentNames,
        home_venue: homeVenue.trim() || null,
      });
      router.replace({ pathname: "/team/[id]", params: { id: team.id } });
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: editing ? "Изменить команду" : "Новая команда" }} />
      <Screen header>
        {loadError ? <Notice kind="danger">{loadError}</Notice> : null}
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={100} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={COMMON_SPORTS.map((s) => ({ value: s, title: s }))} value={sport || null} onChange={setSport} error={errors.sport} />
        <TextField label="Возрастная категория" value={age} onChangeText={setAge} maxLength={50} />
        <Choice label="Уровень" layout="chips" options={LEVELS} value={level} onChange={setLevel} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={1000} />
        <TextField label="Домашняя площадка" value={homeVenue} onChangeText={setHomeVenue} maxLength={200} placeholder="Например, стадион «Заря»" />
        <TextField
          label="Турниры команды (по одному в строке)"
          value={tournaments}
          onChangeText={setTournaments}
          multiline
          numberOfLines={3}
          placeholder={"Осенний кубок\nПервенство города"}
          error={errors.tournaments}
        />
        <Text variant="caption" muted>
          Турниры можно будет выбирать при создании матча, а для домашнего матча подставится домашняя площадка.
        </Text>
        <Button title={editing ? "Сохранить" : "Создать"} onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
