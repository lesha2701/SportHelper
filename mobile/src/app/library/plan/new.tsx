import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { createTrainingPlanDraft } from "@/api/ai";
import { createPlan, getPlan, updatePlan } from "@/api/plans";
import { toFormError } from "@/lib/formError";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** A training plan, new (with an AI draft) or edited (?id=). */
export default function NewPlanScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("");
  const [equipment, setEquipment] = useState("");
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getPlan(id)
      .then((p) => {
        setName(p.name);
        setSport(p.sport);
        setDescription(p.description ?? "");
        setMinutes(p.durationMinutes ? String(p.durationMinutes) : "");
        setEquipment(p.equipment ?? "");
        setComment(p.comment ?? "");
      })
      .catch((e: unknown) => setErrors({ form: toFormError(e).message }));
  }, [id]);

  const [goal, setGoal] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  async function draftWithAi() {
    if (goal.trim().length < 3) return setErrors({ form: "Опишите цель плана в двух словах." });
    setAiBusy(true);
    setErrors({});
    try {
      const d = await createTrainingPlanDraft({ goals: goal.trim(), sport: sport || null, duration_minutes: minutes.trim() ? parseInt(minutes, 10) || null : null });
      setName(d.name);
      if (d.sport) setSport(d.sport);
      setDescription(d.description);
      if (d.durationMinutes) setMinutes(String(d.durationMinutes));
      if (d.equipment) setEquipment(d.equipment);
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Укажите название плана.";
    if (!sport) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        sport,
        description: description.trim() || null,
        duration_minutes: minutes.trim() ? parseInt(minutes, 10) || null : null,
        equipment: equipment.trim() || null,
        comment: comment.trim() || null,
      };
      if (id) {
        await updatePlan(id, input);
        router.back();
        return;
      }
      const plan = await createPlan(input);
      router.replace({ pathname: "/library/plan/[id]", params: { id: plan.id } });
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: id ? "Редактировать план" : "Новый план" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        {!id ? <Card>
          <Text variant="heading">Составить с ИИ</Text>
          <TextField label="Цель плана" value={goal} onChangeText={setGoal} placeholder="Например: развитие скорости у юниоров" maxLength={300} />
          <Button title="Составить черновик" variant="secondary" onPress={draftWithAi} loading={aiBusy} />
        </Card> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={200} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={COMMON_SPORTS.map((s) => ({ value: s, title: s }))} value={sport || null} onChange={setSport} error={errors.sport} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={2000} />
        <TextField label="Длительность, мин" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} />
        <TextField label="Инвентарь" value={equipment} onChangeText={setEquipment} maxLength={200} />
        <TextField label="Комментарий тренера" value={comment} onChangeText={setComment} multiline numberOfLines={2} maxLength={2000} />
        <Button title={id ? "Сохранить" : "Создать"} onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
