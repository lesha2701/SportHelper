import { Stack, router } from "expo-router";
import { useState } from "react";
import { createPlan } from "@/api/plans";
import { toFormError } from "@/lib/formError";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function NewPlanScreen() {
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("");
  const [equipment, setEquipment] = useState("");
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Укажите название плана.";
    if (!sport) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const plan = await createPlan({
        name: name.trim(),
        sport,
        description: description.trim() || null,
        duration_minutes: minutes.trim() ? parseInt(minutes, 10) || null : null,
        equipment: equipment.trim() || null,
        comment: null,
      });
      router.replace({ pathname: "/library/plan/[id]", params: { id: plan.id } });
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Новый план" }} />
      <Screen>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={200} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={COMMON_SPORTS.map((s) => ({ value: s, title: s }))} value={sport || null} onChange={setSport} error={errors.sport} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={2000} />
        <TextField label="Длительность, мин" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} />
        <TextField label="Инвентарь" value={equipment} onChangeText={setEquipment} maxLength={200} />
        <Button title="Создать" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
