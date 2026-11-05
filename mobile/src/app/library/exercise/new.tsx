import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { createExercise, uploadExercisePhoto } from "@/api/exercises";
import { toFormError } from "@/lib/formError";
import { COMMON_SPORTS } from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const int = (text: string) => (text.trim() ? parseInt(text, 10) || null : null);

export default function NewExerciseScreen() {
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [description, setDescription] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [seconds, setSeconds] = useState("");
  const [rest, setRest] = useState("");
  const [equipment, setEquipment] = useState("");
  const [technique, setTechnique] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  }

  async function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = "Укажите название.";
    if (!sport) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const created = await createExercise({
        sport,
        name: name.trim(),
        description: description.trim() || null,
        goal: null,
        sets: int(sets),
        reps: int(reps),
        duration_seconds: int(seconds),
        rest_seconds: int(rest),
        equipment: equipment.trim() || null,
        difficulty: null,
        technique: technique.trim() || null,
        common_mistakes: null,
        warnings: null,
        coach_comment: null,
      });
      if (photo) await uploadExercisePhoto(created.id, { uri: photo.uri, name: photo.fileName ?? "photo.jpg", type: photo.mimeType ?? "image/jpeg" });
      router.replace({ pathname: "/library/exercise/[id]", params: { id: created.id } });
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Новое упражнение" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={name} onChangeText={setName} maxLength={200} error={errors.name} />
        <Choice label="Вид спорта *" layout="chips" options={COMMON_SPORTS.map((s) => ({ value: s, title: s }))} value={sport || null} onChange={setSport} error={errors.sport} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={2000} />
        <TextField label="Подходов" value={sets} onChangeText={setSets} keyboardType="number-pad" maxLength={3} />
        <TextField label="Повторений" value={reps} onChangeText={setReps} keyboardType="number-pad" maxLength={4} />
        <TextField label="Длительность, секунд" value={seconds} onChangeText={setSeconds} keyboardType="number-pad" maxLength={5} />
        <TextField label="Отдых, секунд" value={rest} onChangeText={setRest} keyboardType="number-pad" maxLength={4} />
        <TextField label="Инвентарь" value={equipment} onChangeText={setEquipment} maxLength={200} />
        <TextField label="Техника выполнения" value={technique} onChangeText={setTechnique} multiline numberOfLines={3} maxLength={2000} />
        {photo ? <Text muted>Фото выбрано</Text> : null}
        <Button title={photo ? "Выбрать другое фото" : "Добавить фото"} variant="secondary" onPress={pick} />
        <Button title="Сохранить" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
