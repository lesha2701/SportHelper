import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { deleteTemplate, getTemplate } from "@/api/taskTemplates";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

export default function TemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const template = useLoad(() => getTemplate(id), [id]);
  const [deleting, setDeleting] = useState(false);
  const reload = template.reload;
  useFocusEffect(useCallback(() => reload(), [reload]));

  if (template.loading && !template.data) return <LoadingView />;
  if (template.error || !template.data) return <ErrorView message={template.error ?? "Шаблон не найден"} onRetry={template.reload} />;
  const t = template.data;
  const wanted = [
    t.requireComment && "комментарий",
    t.requirePhoto && "фото",
    t.requireVideo && "видео",
    t.requireSetsReps && "подходы и повторения",
    t.requireDuration && "длительность",
    t.requireMetricValue && "значение показателя",
    t.requireDifficulty && "сложность",
    t.requireWellbeing && "самочувствие",
  ].filter(Boolean);

  async function remove() {
    setDeleting(false);
    try {
      await deleteTemplate(t.id);
      router.back();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Шаблон" }} />
      <Screen header>
        <Text variant="title">{t.title}</Text>
        {t.description ? <Text>{t.description}</Text> : null}
        {t.exercises.length > 0 ? (
          <Card>
            <Text variant="heading">Упражнения</Text>
            {[...t.exercises]
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((e, i) => (
                <Text key={e.id}>
                  {i + 1}. {e.exerciseName ?? "Упражнение"}
                </Text>
              ))}
          </Card>
        ) : null}
        {t.metricName ? (
          <Card>
            <Text variant="heading">Показатель</Text>
            <Text>
              {t.metricName}
              {t.metricUnit ? `, ${t.metricUnit}` : ""}
              {t.metricTarget !== null ? ` · цель ${t.metricTarget}` : ""}
            </Text>
          </Card>
        ) : null}
        <Card>
          <Text variant="heading">К отчёту приложить</Text>
          <Text muted>{wanted.length ? wanted.join(", ") : "ничего"}</Text>
        </Card>
        <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/library/template/new", params: { id: t.id } })} />
        <Button title="Удалить шаблон" variant="ghost" onPress={() => setDeleting(true)} />
        <ConfirmModal visible={deleting} title="Удалить шаблон?" confirmLabel="Удалить" destructive onCancel={() => setDeleting(false)} onConfirm={() => void remove()} />
      </Screen>
    </>
  );
}
