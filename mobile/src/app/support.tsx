import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { createSupportRequest, listMySupportRequests, replyToSupportRequest, SUPPORT_KIND_LABELS, SUPPORT_STATUS_LABELS, type MySupportRequest, type SupportKind } from "@/api/support";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { useProfile } from "@/profile/ProfileProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const KINDS = (Object.keys(SUPPORT_KIND_LABELS) as SupportKind[])
  .filter((value) => value !== "venue_search")
  .map((value) => ({ value, title: SUPPORT_KIND_LABELS[value] }));

function NewRequest({ onCreated, venueSearch }: { onCreated: () => void; venueSearch: boolean }) {
  const [kind, setKind] = useState<SupportKind | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanSubject = subject.trim().replace(/\s+/g, " ");
  const cleanBody = body.trim();
  const requestKind = venueSearch ? "venue_search" : kind;
  const valid = !!requestKind && cleanSubject.length >= (venueSearch ? 2 : 3) && cleanBody.length >= 10;

  async function submit() {
    if (!requestKind || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createSupportRequest({
        kind: requestKind,
        subject: venueSearch ? `Подбор зала: ${cleanSubject}` : cleanSubject,
        body: cleanBody,
      });
      onCreated();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {venueSearch ? <Text muted>Расскажите, какой зал нужен для тренировки. Ответ команды появится здесь.</Text> : (
        <>
          <Text variant="heading">Новое обращение</Text>
          <Choice label="Тема обращения" layout="chips" options={KINDS} value={kind} onChange={setKind} disabled={busy} />
        </>
      )}
      <TextField label={venueSearch ? "Город" : "Заголовок"} placeholder={venueSearch ? "Например, Москва" : undefined} value={subject} onChangeText={setSubject} maxLength={venueSearch ? 100 : 120} editable={!busy} required />
      <TextField label={venueSearch ? "Какой зал нужен" : "Сообщение"} placeholder={venueSearch ? "Вид спорта, район, дата и время, бюджет" : undefined} value={body} onChangeText={setBody} maxLength={3000} editable={!busy} multiline required />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title={venueSearch ? "Отправить заявку" : "Отправить обращение"} loading={busy} disabled={!valid} onPress={() => void submit()} />
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
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { state, reload } = useProfile();
  const venueSearch = kind === "venue_search";
  if (venueSearch && (state.status === "idle" || state.status === "loading")) return <LoadingView />;
  if (venueSearch && state.status === "error") {
    return <ErrorView message={state.message} onRetry={reload} />;
  }
  const showVenueForm = venueSearch && state.status === "ready" && !!state.data.coach;
  return <SupportRequests key={showVenueForm ? "venue" : "general"} venueSearch={showVenueForm} />;
}

function SupportRequests({ venueSearch }: { venueSearch: boolean }) {
  const data = useLoad(listMySupportRequests);
  const [writing, setWriting] = useState(venueSearch);
  const [created, setCreated] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const requests = (data.data ?? []).filter((request) => !venueSearch || request.kind === "venue_search");

  function refresh() {
    data.reload();
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: venueSearch ? "Подбор зала" : "Поддержка" }} />
      <Screen header onRefresh={refresh} refreshing={data.loading && !!data.data}>
        <Button title={writing ? "Свернуть форму" : venueSearch ? "Новая заявка" : "Написать в поддержку"} variant="secondary" onPress={() => { setCreated(false); setWriting(!writing); }} />
        {created ? <Notice>{venueSearch ? "Заявка отправлена. Ответ команды появится здесь." : "Спасибо. Обращение отправлено, ответ появится здесь и придёт на почту."}</Notice> : null}
        {writing ? <NewRequest venueSearch={venueSearch} onCreated={() => {
          setCreated(true);
          setWriting(false);
          refresh();
        }} /> : null}
        <Text variant="heading">{venueSearch ? "Мои заявки на подбор зала" : "Мои обращения"}</Text>
        {data.loading && !data.data ? <LoadingView /> : null}
        {data.error ? <ErrorView message={data.error} onRetry={refresh} /> : null}
        {data.data && !requests.length ? <Text muted>{venueSearch ? "У вас пока нет заявок." : "У вас пока нет обращений."}</Text> : null}
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
