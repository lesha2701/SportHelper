import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { listMyExercises } from "@/api/exercises";
import { listMyPlans } from "@/api/plans";
import { createTemplate, getTemplate, updateTemplate } from "@/api/taskTemplates";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { LoadingView } from "@/ui/StateViews";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const REQUIREMENTS = [
  { key: "comment", label: "Комментарий" },
  { key: "photo", label: "Фото" },
  { key: "video", label: "Видео" },
  { key: "setsReps", label: "Подходы и повторения" },
  { key: "duration", label: "Длительность" },
  { key: "metric", label: "Значение показателя" },
  { key: "difficulty", label: "Сложность (1–10)" },
  { key: "wellbeing", label: "Самочувствие (1–5)" },
] as const;
type ReqKey = (typeof REQUIREMENTS)[number]["key"];
const NO_REQ: Record<ReqKey, boolean> = { comment: true, photo: false, video: false, setsReps: false, duration: false, metric: false, difficulty: false, wellbeing: false };

/** A task template (as on the website): title, description, a plan, exercises in their order, a measurement to report,
 * and what the report must contain. New, or edited with ?id=. */
export default function TemplateFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const plans = useLoad(listMyPlans);
  const exercises = useLoad(listMyExercises);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [exerciseIds, setExerciseIds] = useState<string[]>([]);
  const [metric, setMetric] = useState({ name: "", unit: "", target: "" });
  const [req, setReq] = useState(NO_REQ);
  const [loading, setLoading] = useState(!!id);
  const [errors, setErrors] = useState<{ title?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTemplate(id)
      .then((t) => {
        setTitle(t.title);
        setDescription(t.description ?? "");
        setPlanId(t.planId);
        setExerciseIds([...t.exercises].sort((a, b) => a.orderIndex - b.orderIndex).map((e) => e.exerciseId));
        setMetric({ name: t.metricName ?? "", unit: t.metricUnit ?? "", target: t.metricTarget?.toString() ?? "" });
        setReq({
          comment: t.requireComment,
          photo: t.requirePhoto,
          video: t.requireVideo,
          setsReps: t.requireSetsReps,
          duration: t.requireDuration,
          metric: t.requireMetricValue,
          difficulty: t.requireDifficulty,
          wellbeing: t.requireWellbeing,
        });
      })
      .catch((e: unknown) => setErrors({ form: toFormError(e).message }))
      .finally(() => setLoading(false));
  }, [id]);

  function move(index: number, by: -1 | 1) {
    setExerciseIds((ids) => {
      const next = [...ids];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  async function submit() {
    if (!title.trim()) return setErrors({ title: "Укажите название шаблона." });
    const target = metric.target.trim() ? Number(metric.target.replace(",", ".")) : null;
    if (target !== null && Number.isNaN(target)) return setErrors({ form: "Цель показателя — число." });
    setBusy(true);
    const input = {
      title: title.trim(),
      description: description.trim() || null,
      plan_id: planId,
      exercise_ids: exerciseIds,
      metric_name: metric.name.trim() || null,
      metric_unit: metric.unit.trim() || null,
      metric_target: target,
      require_comment: req.comment,
      require_photo: req.photo,
      require_video: req.video,
      require_sets_reps: req.setsReps,
      require_duration: req.duration,
      require_metric_value: req.metric,
      require_difficulty: req.difficulty,
      require_wellbeing: req.wellbeing,
    };
    try {
      if (id) await updateTemplate(id, input);
      else await createTemplate(input);
      router.back();
    } catch (e) {
      setErrors({ form: toFormError(e).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingView />;
  const nameOf = (exerciseId: string) => exercises.data?.find((e) => e.id === exerciseId)?.name ?? "Упражнение";
  const notChosen = (exercises.data ?? []).filter((e) => !exerciseIds.includes(e.id));

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: id ? "Редактировать шаблон" : "Новый шаблон" }} />
      <Screen header>
        {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
        <TextField label="Название" required value={title} onChangeText={setTitle} maxLength={200} error={errors.title} />
        <TextField label="Описание" value={description} onChangeText={setDescription} multiline numberOfLines={4} maxLength={2000} />

        {(plans.data ?? []).length > 0 ? (
          <Choice
            label="План тренировки (необязательно)"
            layout="chips"
            options={(plans.data ?? []).map((p) => ({ value: p.id, title: p.name }))}
            value={planId}
            onChange={(v) => setPlanId(v === planId ? null : v)}
          />
        ) : null}

        <Card>
          <Text variant="heading">Упражнения</Text>
          {exerciseIds.length === 0 ? <Text muted>Не выбраны.</Text> : null}
          {exerciseIds.map((exId, i) => (
            <View key={exId} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1 }}>
                {i + 1}. {nameOf(exId)}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Выше" disabled={i === 0} hitSlop={6} onPress={() => move(i, -1)} style={{ opacity: i === 0 ? 0.3 : 1 }}>
                <Ionicons name="arrow-up" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ниже"
                disabled={i === exerciseIds.length - 1}
                hitSlop={6}
                onPress={() => move(i, 1)}
                style={{ opacity: i === exerciseIds.length - 1 ? 0.3 : 1 }}
              >
                <Ionicons name="arrow-down" size={20} color={colors.text} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Убрать" hitSlop={6} onPress={() => setExerciseIds((ids) => ids.filter((x) => x !== exId))}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
          {notChosen.length > 0 ? (
            <Choice label="Добавить" layout="chips" options={notChosen.map((e) => ({ value: e.id, title: e.name }))} value={null} onChange={(v) => setExerciseIds((ids) => [...ids, v])} />
          ) : null}
        </Card>

        <Card>
          <Text variant="heading">Показатель (необязательно)</Text>
          <TextField label="Название" value={metric.name} onChangeText={(name) => setMetric((m) => ({ ...m, name }))} placeholder="Например: прыжок в длину" maxLength={100} />
          <TextField label="Единица" value={metric.unit} onChangeText={(unit) => setMetric((m) => ({ ...m, unit }))} placeholder="см, сек, кг" maxLength={20} />
          <TextField label="Цель" value={metric.target} onChangeText={(target) => setMetric((m) => ({ ...m, target }))} keyboardType="decimal-pad" maxLength={12} />
        </Card>

        <Card>
          <Text variant="heading">Формат подтверждения</Text>
          {REQUIREMENTS.map((r) => (
            <SwitchRow key={r.key} label={r.label} value={req[r.key]} onChange={(v) => setReq((cur) => ({ ...cur, [r.key]: v }))} />
          ))}
        </Card>
        <Button title="Сохранить шаблон" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
