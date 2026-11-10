import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { getReport, reviewReport, submitReport, uploadReportPhoto, uploadReportVideo } from "@/api/reports";
import { ApiError } from "@/api/client";
import { getTeam } from "@/api/teams";
import { getTraining } from "@/api/trainings";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { pickMedia } from "@/lib/pickImage";
import { useLoad } from "@/lib/useLoad";
import { formatDayTitle } from "@/shared/lib/dates";
import { REPORT_STATUS_LABELS } from "@/shared/types/report";
import { AuthImage } from "@/ui/AuthImage";
import { AuthVideo } from "@/ui/AuthVideo";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { EmptyView, ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** The report of an independent training (one the team trains on its own): the responsible player writes it and may
 * add a photo or video; the coach accepts it or sends it back. */
export default function TrainingReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const data = useLoad(async () => {
    const training = await getTraining(id);
    const team = training.teamId ? await getTeam(training.teamId).catch(() => null) : null;
    const report = await getReport(id).catch((e: unknown) => {
      if (e instanceof ApiError && e.code === "not_found") return null;
      throw e;
    });
    return { training, team, report };
  }, [id]);
  const [text, setText] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Не удалось загрузить отчёт"} onRetry={data.reload} />;
  const { training, team, report } = data.data;
  const responsible = !!user && training.responsibleUserId === user.id;
  const coach = team?.myRole === "head_coach" || team?.myRole === "assistant_coach";
  const draft = text ?? report?.textReport ?? "";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      data.reload();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function attach(kind: "image" | "video") {
    const file = await pickMedia(kind);
    if (!file) return;
    await run(() => (file.video ? uploadReportVideo(id, file) : uploadReportPhoto(id, file)));
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Отчёт о тренировке" }} />
      <Screen header onRefresh={data.reload} refreshing={data.loading}>
        <Text variant="label" muted>
          {formatDayTitle(training.trainingDate)} · {training.startTime.slice(0, 5)}
          {report ? ` · ${REPORT_STATUS_LABELS[report.status]}` : ""}
        </Text>
        {error ? <Notice kind="danger">{error}</Notice> : null}

        {!report && !responsible ? <EmptyView title="Отчёт ещё не отправлен" hint="Ответственный игрок пока не написал отчёт об этой тренировке." /> : null}

        {responsible ? (
          <Card>
            <TextField
              label="Короткий отчёт"
              value={draft}
              onChangeText={setText}
              multiline
              numberOfLines={5}
              maxLength={2000}
              placeholder="Как прошла тренировка, кто отсутствовал, что стоит отметить тренеру"
            />
            <Button title={report ? "Обновить отчёт" : "Отправить отчёт"} onPress={() => run(() => submitReport(id, draft.trim()))} loading={busy} disabled={!draft.trim()} />
            {report ? (
              <>
                <Button title={report.photoFileId ? "Заменить фото" : "Добавить фото (необязательно)"} variant="secondary" onPress={() => attach("image")} disabled={busy} />
                <Button title={report.videoFileId ? "Заменить видео" : "Добавить видео (необязательно)"} variant="secondary" onPress={() => attach("video")} disabled={busy} />
              </>
            ) : null}
          </Card>
        ) : null}

        {report && !responsible ? (
          <Card>
            <Text>{report.textReport}</Text>
          </Card>
        ) : null}
        {report?.photoFileId ? <AuthImage fileId={report.photoFileId} /> : null}
        {report?.videoFileId ? <AuthVideo fileId={report.videoFileId} /> : null}
        {report?.coachComment ? (
          <Card>
            <Text variant="label">Комментарий тренера</Text>
            <Text>{report.coachComment}</Text>
          </Card>
        ) : null}

        {report && coach ? (
          <Card>
            <TextField label="Комментарий (необязательно)" value={comment} onChangeText={setComment} multiline numberOfLines={3} maxLength={1000} />
            <Button title="Принять отчёт" onPress={() => run(() => reviewReport(id, "accepted", comment.trim() || null).then(() => setComment("")))} loading={busy} />
            <Button title="Вернуть на доработку" variant="secondary" onPress={() => run(() => reviewReport(id, "needs_revision", comment.trim() || null).then(() => setComment("")))} disabled={busy} />
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
