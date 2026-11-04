import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { createMatch } from "@/api/matches";
import { toFormError } from "@/lib/formError";
import { parseRuDate, parseTime } from "@/shared/lib/dates";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { DateField, TimeField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function NewMatchScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const [opponent, setOpponent] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [location, setLocation] = useState("");
  const [home, setHome] = useState<"home" | "away">("home");
  const [tournament, setTournament] = useState("");
  const [errors, setErrors] = useState<{ opponent?: string; date?: string; time?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

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
      <Stack.Screen options={{ headerShown: true, title: "Новый матч" }} />
      <Screen>
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
        <Button title="Создать матч" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
