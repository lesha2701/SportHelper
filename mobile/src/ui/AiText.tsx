import { useState } from "react";
import { toFormError } from "@/lib/formError";
import { Button } from "./Button";
import { Card } from "./Card";
import { Notice } from "./Notice";
import { Text } from "./Text";

/** A button that asks the AI for a text (an analysis, an evaluation) and shows the answer or why there is none. */
export function AiText({ title, load, heading }: { title: string; load: () => Promise<string>; heading?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setText(await load());
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button title={text ? `${title}: обновить` : title} variant="secondary" onPress={run} loading={busy} />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {text ? (
        <Card>
          {heading ? <Text variant="heading">{heading}</Text> : null}
          <Text>{text}</Text>
          <Text variant="caption" muted>
            Текст составлен ИИ и может содержать неточности.
          </Text>
        </Card>
      ) : null}
    </>
  );
}
