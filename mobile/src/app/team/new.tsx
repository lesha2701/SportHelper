import { Stack, router } from "expo-router";
import { useState } from "react";
import { createTeam } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { COMMON_SPORTS, SKILL_LEVEL_LABELS, type SkillLevel } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

const LEVELS = (Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]).map((value) => ({ value, title: SKILL_LEVEL_LABELS[value] }));

export default function NewTeamScreen() {
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState<SkillLevel | null>(null);
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Укажите название.";
    if (!sport) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const team = await createTeam({
        name: name.trim(),
        sport,
        description: description.trim() || null,
        age_category: age.trim() || null,
        level,
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
      <Stack.Screen options={{ headerShown: true, title: "Новая команда" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={100} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={COMMON_SPORTS.map((s) => ({ value: s, title: s }))} value={sport || null} onChange={setSport} error={errors.sport} />
        <TextField label="Возрастная категория" value={age} onChangeText={setAge} maxLength={50} />
        <Choice label="Уровень" layout="chips" options={LEVELS} value={level} onChange={setLevel} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={1000} />
        <Button title="Создать" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
