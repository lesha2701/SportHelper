import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { useProfile } from "@/profile/ProfileProvider";
import { toFormError } from "@/lib/formError";
import {
  COMMON_SPORTS,
  SKILL_LEVEL_LABELS,
  type CoachProfile,
  type PlayerProfile,
  type SkillLevel,
} from "@/shared/types/profile";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const SPORT_OPTIONS = COMMON_SPORTS.map((s) => ({ value: s, title: s }));
const LEVEL_OPTIONS = (Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[]).map((value) => ({ value, title: SKILL_LEVEL_LABELS[value] }));

/** An optional whole number; null when empty, NaN-safe. */
function toInt(text: string): number | null {
  const n = parseInt(text.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function SportPicker({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  // Older records may hold a free-text sport: keep and show it as an extra option.
  const options = value && !COMMON_SPORTS.includes(value) ? [...SPORT_OPTIONS, { value, title: value }] : SPORT_OPTIONS;
  return <Choice label="Вид спорта *" layout="chips" options={options} value={value || null} onChange={onChange} error={error} />;
}

function PlayerForm({ initial, first, onSaved }: { initial: PlayerProfile | null; first: boolean; onSaved: () => void }) {
  const { user } = useAuth();
  const { savePlayer } = useProfile();
  const [fullName, setFullName] = useState(initial?.fullName ?? user?.firstName ?? "");
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [level, setLevel] = useState<SkillLevel | null>(initial?.level ?? null);
  const [age, setAge] = useState(initial?.age?.toString() ?? "");
  const [height, setHeight] = useState(initial?.heightCm?.toString() ?? "");
  const [weight, setWeight] = useState(initial?.weightKg?.toString() ?? "");
  const [goals, setGoals] = useState(initial?.goals ?? "");
  const [limits, setLimits] = useState(initial?.loadRestrictions ?? "");
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!fullName.trim()) found.name = "Укажите имя.";
    if (!sport.trim()) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await savePlayer({
        full_name: fullName.trim(),
        age: toInt(age),
        height_cm: toInt(height),
        weight_kg: toInt(weight),
        sport: sport.trim(),
        position: position.trim() || null,
        level,
        goals: goals.trim() || null,
        load_restrictions: limits.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text variant="title">{first ? "Расскажите о себе" : "Профиль игрока"}</Text>
      {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
      <TextField label="Имя" required value={fullName} onChangeText={setFullName} maxLength={100} error={errors.name} />
      <SportPicker value={sport} onChange={setSport} error={errors.sport} />
      <TextField label="Позиция" value={position} onChangeText={setPosition} maxLength={100} />
      <Choice label="Уровень" layout="chips" options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
      <TextField label="Возраст" value={age} onChangeText={setAge} keyboardType="number-pad" maxLength={3} />
      <TextField label="Рост, см" value={height} onChangeText={setHeight} keyboardType="number-pad" maxLength={3} />
      <TextField label="Вес, кг" value={weight} onChangeText={setWeight} keyboardType="number-pad" maxLength={3} />
      <TextField label="Цели" value={goals} onChangeText={setGoals} multiline numberOfLines={3} maxLength={1000} />
      <TextField label="Ограничения по нагрузке" value={limits} onChangeText={setLimits} multiline numberOfLines={3} maxLength={1000} />
      <Button title="Сохранить" onPress={submit} loading={busy} />
    </>
  );
}

function CoachForm({ initial, first, onSaved }: { initial: CoachProfile | null; first: boolean; onSaved: () => void }) {
  const { user } = useAuth();
  const { saveCoach } = useProfile();
  const [fullName, setFullName] = useState(initial?.fullName ?? user?.firstName ?? "");
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [experience, setExperience] = useState(initial?.experienceYears?.toString() ?? "");
  const [specialization, setSpecialization] = useState(initial?.specialization ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [errors, setErrors] = useState<{ name?: string; sport?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!fullName.trim()) found.name = "Укажите имя.";
    if (!sport.trim()) found.sport = "Выберите вид спорта.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await saveCoach({
        full_name: fullName.trim(),
        sport: sport.trim(),
        experience_years: toInt(experience),
        specialization: specialization.trim() || null,
        description: description.trim() || null,
      });
      onSaved();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text variant="title">{first ? "Расскажите о себе" : "Профиль тренера"}</Text>
      {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
      <TextField label="Имя" required value={fullName} onChangeText={setFullName} maxLength={100} error={errors.name} />
      <SportPicker value={sport} onChange={setSport} error={errors.sport} />
      <TextField label="Опыт, лет" value={experience} onChangeText={setExperience} keyboardType="number-pad" maxLength={2} />
      <TextField label="Специализация" value={specialization} onChangeText={setSpecialization} maxLength={200} />
      <TextField label="О себе" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />
      <Button title="Сохранить" onPress={submit} loading={busy} />
    </>
  );
}

/** Creates (first run) or edits the profile of the role given in `mode`. */
export default function ProfileEditScreen() {
  const { mode = "player", first } = useLocalSearchParams<{ mode?: string; first?: string }>();
  const { state } = useProfile();
  const { signOut } = useAuth();
  const isFirst = first === "1";
  if (state.status !== "ready") return null;

  const done = () => (isFirst ? router.replace("/home") : router.back());
  return (
    <Screen>
      {mode === "coach" ? (
        <CoachForm initial={state.data.coach} first={isFirst} onSaved={done} />
      ) : (
        <PlayerForm initial={state.data.player} first={isFirst} onSaved={done} />
      )}
      {isFirst ? (
        <LinkText style={{ textAlign: "center" }} onPress={() => void signOut()}>
          Выйти из аккаунта
        </LinkText>
      ) : (
        <Button title="Отмена" variant="ghost" onPress={() => router.back()} />
      )}
    </Screen>
  );
}
