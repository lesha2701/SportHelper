import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { createMatch, getMatch, updateMatch } from "@/api/matches";
import { toFormError } from "@/lib/formError";
import type { Match } from "@/shared/types/match";
import { formatRuDate, parseRuDate, parseTime } from "@/shared/lib/dates";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function NewMatchScreen() {
  const { teamId: teamParam, id } = useLocalSearchParams<{ teamId?: string; id?: string }>();
  const editing = !!id;
  const [loaded, setLoaded] = useState<Match | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const teamId = (teamParam ?? loaded?.teamId) as string;
  const [opponent, setOpponent] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [location, setLocation] = useState("");
  const [home, setHome] = useState<"home" | "away">("home");
  const [tournament, setTournament] = useState("");
  const [errors, setErrors] = useState<{ opponent?: string; date?: string; time?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getMatch(id)
      .then((m) => {
        setLoaded(m);
        setOpponent(m.opponentName);
        setDate(formatRuDate(m.matchDate));
        setTime(m.startTime.slice(0, 5));
        setLocation(m.location ?? "");
        setHome(m.isHome ? "home" : "away");
        setTournament(m.tournament ?? "");
      })
      .catch((e: unknown) => setLoadError(toFormError(e).message));
  }, [id]);

  async function submit() {
    const found: typeof errors = {};
    const iso = parseRuDate(date);
    const start = parseTime(time);
    if (!opponent.trim()) found.opponent = "Укажите соперника.";
    if (!iso) found.date = "Введите дату как ДД.ММ.ГГГГ.";
    if (!start) found.time = "Введите время как ЧЧ:ММ.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (editing && loaded) {
        await updateMatch(loaded.id, {
          opponent_name: opponent.trim(),
          match_date: iso!,
          start_time: start!,
          location: location.trim() || null,
          is_home: home === "home",
          tournament: tournament.trim() || null,
          status: loaded.status,
        });
        router.back();
        return;
      }
      const match = await createMatch(teamId, {
        opponent_name: opponent.trim(),
        match_date: iso!,
        start_time: start!,
        location: location.trim() || null,
        is_home: home === "home",
        tournament: tournament.trim() || null,
      });
      router.replace({ pathname: "/match/[id]", params: { id: match.id, teamId } });
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: editing ? "Изменить матч" : "Новый матч" }} />
      <Screen header>
        {loadError ? <Notice kind="danger">{loadError}</Notice> : null}
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Соперник" required value={opponent} onChangeText={setOpponent} maxLength={100} error={errors.opponent} />
        <DateField label="Дата" required value={date} onChange={setDate} error={errors.date} shortcuts />
        <TimeField label="Начало" required value={time} onChange={setTime} error={errors.time} />
        <Choice
          layout="chips"
          options={[
            { value: "home", title: "Дома" },
            { value: "away", title: "В гостях" },
          ]}
          value={home}
          onChange={setHome}
        />
        <TextField label="Место" value={location} onChangeText={setLocation} maxLength={200} />
        <TextField label="Турнир" value={tournament} onChangeText={setTournament} maxLength={200} />
        <Button title={editing ? "Сохранить" : "Создать матч"} onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
