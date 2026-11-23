import { Stack } from "expo-router";
import { useState } from "react";
import { createSupportRequest, listMySupportRequests, replyToSupportRequest, SUPPORT_KIND_LABELS, SUPPORT_STATUS_LABELS, type MySupportRequest, type SupportKind } from "@/api/support";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const KINDS = (Object.keys(SUPPORT_KIND_LABELS) as SupportKind[]).map((value) => ({ value, title: SUPPORT_KIND_LABELS[value] }));

function NewRequest({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<SupportKind | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!kind || subject.trim().length < 3 || body.trim().length < 10 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createSupportRequest({ kind, subject: subject.trim(), body: body.trim() });
      onCreated();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Новое обращение</Text>
      <Choice label="Тема обращения" layout="chips" options={KINDS} value={kind} onChange={setKind} disabled={busy} />
      <TextField label="Заголовок" value={subject} onChangeText={setSubject} maxLength={120} editable={!busy} required />
      <TextField label="Сообщение" value={body} onChangeText={setBody} maxLength={3000} editable={!busy} multiline required />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Отправить обращение" loading={busy} disabled={!kind || subject.trim().length < 3 || body.trim().length < 10} onPress={() => void submit()} />
    </Card>
  );
}

function SupportConversation({ request, onReply }: { request: MySupportRequest; onReply: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reply() {
    if (draft.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await replyToSupportRequest(request.id, draft.trim());
      onReply();
      setDraft("");
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="label">{request.subject}</Text>
      <Text muted>{SUPPORT_STATUS_LABELS[request.status] ?? "Статус обновляется"}</Text>
      <Text>{request.body}</Text>
      {request.messages.map((message) => (
        <Card key={message.id}>
          <Text variant="label">{message.fromStaff ? "Поддержка" : "Вы"}</Text>
          <Text>{message.body}</Text>
          <Text muted variant="caption">{new Date(message.createdAt).toLocaleString("ru-RU")}</Text>
        </Card>
      ))}
      {request.canReply ? (
        <>
          <TextField label="Ваш ответ" value={draft} onChangeText={setDraft} maxLength={3000} editable={!busy} multiline />
          <Button title="Отправить ответ" disabled={draft.trim().length < 3} loading={busy} onPress={() => void reply()} />
        </>
      ) : <Text muted>{request.status === "closed" ? "Обращение закрыто." : "В этом обращении достигнут лимит сообщений."}</Text>}
      {error ? <Notice kind="danger">{error}</Notice> : null}
    </Card>
  );
}

export default function SupportScreen() {
  const data = useLoad(listMySupportRequests);
  const [writing, setWriting] = useState(false);
  const [created, setCreated] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const requests = data.data ?? [];

  function refresh() {
    data.reload();
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Поддержка" }} />
      <Screen header onRefresh={refresh} refreshing={data.loading && !!data.data}>
        <Button title={writing ? "Свернуть форму" : "Написать в поддержку"} variant="secondary" onPress={() => { setCreated(false); setWriting(!writing); }} />
        {created ? <Notice>Спасибо. Обращение отправлено, ответ появится здесь и придёт на почту.</Notice> : null}
        {writing ? <NewRequest onCreated={() => {
          setCreated(true);
          setWriting(false);
          refresh();
        }} /> : null}
        <Text variant="heading">Мои обращения</Text>
        {data.loading && !data.data ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={refresh} /> : null}
        {data.data && !requests.length ? <Text muted>У вас пока нет обращений.</Text> : null}
        {requests.map((request) => (
            <Card key={request.id}>
              <Button title={request.subject} variant="secondary" onPress={() => setExpanded(expanded === request.id ? null : request.id)} />
              {expanded === request.id ? <SupportConversation request={request} onReply={data.reload} /> : (
                <Text muted>{SUPPORT_KIND_LABELS[request.kind]} · {SUPPORT_STATUS_LABELS[request.status]} · {new Date(request.createdAt).toLocaleDateString("ru-RU")}</Text>
              )}
            </Card>
        ))}
      </Screen>
    </>
  );
}
