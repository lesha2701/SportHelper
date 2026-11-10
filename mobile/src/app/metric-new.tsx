import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { createMetric, listMetrics, updateMetric } from "@/api/metrics";
import { toFormError } from "@/lib/formError";
import { formatRuDate, parseRuDate, todayIso } from "@/shared/lib/dates";
import { Button } from "@/ui/Button";
import { DateField } from "@/ui/DateTimeFields";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { SwitchRow } from "@/ui/SwitchRow";
import { TextField } from "@/ui/TextField";

/** A measurement of a player, new or edited (?metricId=, only the one who recorded it). */
export default function NewMetricScreen() {
  const { userId, metricId } = useLocalSearchParams<{ userId: string; metricId?: string }>();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(formatRuDate(todayIso()));
  const [higher, setHigher] = useState(true);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<{ name?: string; value?: string; date?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!metricId) return;
    listMetrics(userId)
      .then((all) => {
        const m = all.find((x) => x.id === metricId);
        if (!m) return;
        setName(m.name);
        setUnit(m.unit ?? "");
        setValue(String(m.value));
        setDate(formatRuDate(m.recordedDate));
        setHigher(m.higherIsBetter);
        setComment(m.comment ?? "");
      })
      .catch((e: unknown) => setErrors({ form: toFormError(e).message }));
  }, [userId, metricId]);

  async function submit() {
    const found: typeof errors = {};
    const iso = parseRuDate(date);
    const number = Number(value.replace(",", "."));
    if (!name.trim()) found.name = "Укажите название показателя.";
    if (!value.trim() || !Number.isFinite(number)) found.value = "Введите число.";
    if (!iso) found.date = "Введите дату как ДД.ММ.ГГГГ.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        unit: unit.trim() || null,
        value: number,
        recorded_date: iso!,
        higher_is_better: higher,
        source: null,
        comment: comment.trim() || null,
      };
      if (metricId) await updateMetric(metricId, input);
      else await createMetric(userId, input);
      router.back();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: metricId ? "Изменить показатель" : "Новый показатель" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={100} error={errors.name} />
        <TextField label="Значение" required value={value} onChangeText={setValue} keyboardType="decimal-pad" error={errors.value} />
        <TextField label="Единица (кг, с, м…)" value={unit} onChangeText={setUnit} maxLength={20} />
        <DateField label="Дата замера" required value={date} onChange={setDate} error={errors.date} shortcuts />
        <SwitchRow label="Чем больше, тем лучше" value={higher} onChange={setHigher} />
        <TextField label="Комментарий" value={comment} onChangeText={setComment} multiline numberOfLines={2} maxLength={500} />
        <Button title="Сохранить" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
