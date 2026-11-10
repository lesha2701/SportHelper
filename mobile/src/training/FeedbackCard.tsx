import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { getTrainingEvaluation } from "@/api/ai";
import { getTrainingFeedback, skipTrainingFeedback, submitTrainingFeedback } from "@/api/trainings";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import type { TrainingFeedback } from "@/shared/types/training";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { AiText } from "@/ui/AiText";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** A row of numbered buttons (1–5 or 1–10). */
function Scale({ max, value, onChange }: { max: number; value: number | null; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.scale}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = n === value;
        return (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(n)}
            style={[styles.step, { backgroundColor: active ? colors.primary : colors.surfaceAlt }]}
          >
            <Text variant="label" style={{ color: active ? colors.primaryText : colors.text }}>
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** After a held training, as on the website: a player tells how it went (wellbeing, load, a comment) and gets the AI
 * evaluation; the team's coach rates the team. Either can skip. */
export function FeedbackCard({ trainingId, teamCoach }: { trainingId: string; teamCoach: boolean }) {
  const loaded = useLoad(() => getTrainingFeedback(trainingId), [trainingId]);
  const [saved, setSaved] = useState<TrainingFeedback | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loaded.loading && !loaded.data && saved === undefined) return null;
  if (loaded.error && saved === undefined) {
    return (
      <Card>
        <Notice kind="danger">Не удалось загрузить отзыв о тренировке.</Notice>
        <Button title="Повторить" variant="secondary" onPress={loaded.reload} />
      </Card>
    );
  }
  const feedback = saved !== undefined ? saved : (loaded.data ?? null);

  async function send() {
    if (teamCoach && rating === null) return setError("Поставьте оценку команде.");
    setBusy(true);
    setError(null);
    try {
      const body = teamCoach
        ? { team_rating: rating, difficulty, comment: comment.trim() || null }
        : { wellbeing: rating, difficulty, comment: comment.trim() || null };
      setSaved(await submitTrainingFeedback(trainingId, body));
      setEditing(false);
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      setSaved(await skipTrainingFeedback(trainingId));
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (feedback === null || editing) {
    return (
      <Card>
        <Text variant="heading">{teamCoach ? "Как команда провела тренировку?" : "Как прошла тренировка?"}</Text>
        <Text muted>{teamCoach ? "Оцените команду в целом: как она работала, собранность, настрой." : "Коротко расскажите, как всё прошло — это поможет ИИ дать конкретную оценку."}</Text>
        <Text variant="label">{teamCoach ? "Общая оценка команды (1 — слабо, 5 — отлично)" : "Самочувствие (1 — плохо, 5 — отлично)"}</Text>
        <Scale max={5} value={rating} onChange={setRating} />
        <Text variant="label">Нагрузка (1 — легко, 10 — на пределе)</Text>
        <Scale max={10} value={difficulty} onChange={setDifficulty} />
        <TextField
          label="Комментарий (необязательно)"
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={3}
          maxLength={1000}
          placeholder={teamCoach ? "Что получилось, над чем поработать в следующий раз…" : "Что было тяжело, что легко, самочувствие…"}
        />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title={teamCoach ? "Сохранить оценку" : "Сохранить"} onPress={send} loading={busy} />
        {editing ? <Button title="Отмена" variant="ghost" onPress={() => setEditing(false)} /> : <Button title="Пропустить" variant="ghost" onPress={skip} disabled={busy} />}
      </Card>
    );
  }

  if (teamCoach) {
    return (
      <Card>
        <Text variant="heading">Оценка команды</Text>
        {feedback.skipped || feedback.teamRating === null ? (
          <Text muted>Вы не оценивали эту тренировку.</Text>
        ) : (
          <>
            <Text>Общая оценка: {feedback.teamRating} / 5</Text>
            {feedback.difficulty !== null ? <Text>Нагрузка: {feedback.difficulty} / 10</Text> : null}
            {feedback.comment ? <Text muted>{feedback.comment}</Text> : null}
          </>
        )}
        <Button
          title={feedback.teamRating === null ? "Оценить команду" : "Изменить оценку"}
          variant="secondary"
          onPress={() => {
            setRating(feedback.teamRating);
            setDifficulty(feedback.difficulty);
            setComment(feedback.comment ?? "");
            setEditing(true);
          }}
        />
      </Card>
    );
  }

  return (
    <>
      {!feedback.skipped ? (
        <Card>
          <Text variant="heading">Ваш отзыв</Text>
          {feedback.wellbeing !== null ? <Text>Самочувствие: {feedback.wellbeing} / 5</Text> : null}
          {feedback.difficulty !== null ? <Text>Нагрузка: {feedback.difficulty} / 10</Text> : null}
          {feedback.comment ? <Text muted>{feedback.comment}</Text> : null}
        </Card>
      ) : null}
      <AiText title="Оценить тренировку (ИИ)" heading="Оценка ИИ" load={() => getTrainingEvaluation(trainingId)} />
    </>
  );
}

const styles = StyleSheet.create({
  scale: { flexDirection: "row", gap: 4 },
  step: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: radius.md },
});
