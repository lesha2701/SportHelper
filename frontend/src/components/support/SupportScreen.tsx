import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSupportRequest,
  listMySupportRequests,
  replyToSupportRequest,
  SUPPORT_KIND_LABELS,
  SUPPORT_STATUS_LABELS,
  type MySupportRequest,
  type SupportKind,
} from "../../api/support";
import { ApiError } from "../../api/client";
import { TitleWithBack } from "../shared/BackArrow";
import profileStyles from "../profile/profile.module.css";
import styles from "./support.module.css";

const KINDS = Object.keys(SUPPORT_KIND_LABELS) as SupportKind[];
export const SUBJECT_MAX = 120;
export const BODY_MAX = 3000;
const SUBJECT_MIN = 3;
const BODY_MIN = 10;
const REPLY_MIN = 3;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** «Поддержка»: write to the administrators (a question, a suggestion, a conflict, a problem) and read the answers. */
export function SupportScreen({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<SupportKind>("question");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MySupportRequest[] | null>(null);
  const [mineFailed, setMineFailed] = useState(false);

  const loadMine = useCallback(() => {
    listMySupportRequests()
      .then((items) => {
        setMine(items);
        setMineFailed(false);
      })
      .catch(() => setMineFailed(true));
  }, []);
  useEffect(loadMine, [loadMine]);

  const cleanSubject = subject.trim().replace(/\s+/g, " ");
  const cleanBody = body.trim();
  const valid = cleanSubject.length >= SUBJECT_MIN && cleanBody.length >= BODY_MIN;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      await createSupportRequest({ kind, subject: cleanSubject, body: cleanBody });
      setSent(true);
      setSubject("");
      setBody("");
      loadMine();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить обращение. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <TitleWithBack onBack={onBack}>
          <h1 className={profileStyles.pageHeading}>Поддержка</h1>
        </TitleWithBack>
        <p className={profileStyles.subtitle}>
          Есть вопрос, идея или что-то пошло не так? Напишите нам — мы прочитаем и ответим. Ответ придёт на почту и появится здесь, ниже.
        </p>
      </div>

      {sent ? (
        <div className={profileStyles.card} role="status">
          <h2 className={styles.sectionTitle}>Спасибо! Мы получили ваше обращение</h2>
          <p className={profileStyles.subtitle}>Обработаем его и ответим. Ответ придёт на вашу почту и появится в списке ниже.</p>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setSent(false)}>
            Написать ещё
          </button>
        </div>
      ) : (
        <form className={profileStyles.card} onSubmit={submit}>
          <p className={profileStyles.requiredHint}>Поля со звёздочкой (*) обязательны для заполнения.</p>
          <fieldset className={styles.kinds}>
            <legend className={profileStyles.label}>О чём вы хотите написать</legend>
            <div className={styles.kindGrid}>
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? `${styles.kind} ${styles.kindOn}` : styles.kind}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  disabled={sending}
                >
                  {SUPPORT_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Заголовок<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input
              className={profileStyles.input}
              value={subject}
              maxLength={SUBJECT_MAX}
              placeholder="Коротко: о чём речь"
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending}
            />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Текст обращения<span className={profileStyles.requiredMark}>*</span>
            </span>
            <textarea
              className={profileStyles.textarea}
              rows={7}
              value={body}
              maxLength={BODY_MAX}
              placeholder="Опишите подробно: что случилось, что вы ожидали, на каком экране"
              onChange={(e) => setBody(e.target.value)}
              disabled={sending}
            />
            <span className={styles.counter}>
              {body.length} / {BODY_MAX}
            </span>
          </label>

          {error && <p className={profileStyles.error}>{error}</p>}
          <button type="submit" className={profileStyles.buttonPrimary} disabled={!valid || sending}>
            {sending ? "Отправляем…" : "Отправить"}
          </button>
        </form>
      )}

      {mineFailed && <p className={profileStyles.error}>Не удалось загрузить ваши обращения.</p>}
      {mine !== null && mine.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={styles.sectionTitle}>Ваши обращения</h2>
          <ul className={styles.list}>
            {mine.map((r) => (
              <RequestItem key={r.id} request={r} onChanged={(updated) => setMine((list) => list && list.map((x) => (x.id === updated.id ? updated : x)))} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One request as a conversation: the first message, what came back, the person's replies - and a field to write the next one. */
function RequestItem({ request: r, onChanged }: { request: MySupportRequest; onChanged: (updated: MySupportRequest) => void }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = draft.trim();

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (clean.length < REPLY_MIN || sending) return;
    setSending(true);
    setError(null);
    try {
      onChanged(await replyToSupportRequest(r.id, clean));
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить сообщение. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  const thread = [{ id: "first", fromStaff: false, body: r.body, createdAt: r.createdAt }, ...r.messages];

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <div className={styles.itemTitle}>
          <strong className={styles.itemSubject}>{r.subject}</strong>
          <span className={styles.itemMeta}>{SUPPORT_KIND_LABELS[r.kind]}</span>
        </div>
        <span className={r.status === "answered" ? `${styles.badge} ${styles.badgeAnswered}` : styles.badge}>{SUPPORT_STATUS_LABELS[r.status]}</span>
      </div>
      <div className={styles.thread}>
        {thread.map((m) => (
          <div key={m.id} className={m.fromStaff ? `${styles.message} ${styles.fromStaff}` : `${styles.message} ${styles.fromMe}`}>
            <span className={styles.messageAuthor}>
              {m.fromStaff ? "Поддержка" : "Вы"} <span className={styles.messageTime}>· {formatWhen(m.createdAt)}</span>
            </span>
            <p className={styles.itemBody}>{m.body}</p>
          </div>
        ))}
      </div>
      {r.canReply ? (
        <form className={styles.reply} onSubmit={send}>
          <span className={styles.replyLabel}>{r.messages.length > 0 ? "Ваш ответ" : "Дополнить обращение"}</span>
          <textarea
            className={profileStyles.textarea}
            rows={3}
            value={draft}
            maxLength={BODY_MAX}
            placeholder="Напишите сообщение"
            aria-label={`Сообщение в обращении «${r.subject}»`}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sending}
          />
          {error && <p className={profileStyles.error}>{error}</p>}
          <button type="submit" className={profileStyles.buttonSecondary} disabled={clean.length < REPLY_MIN || sending}>
            {sending ? "Отправляем…" : "Отправить сообщение"}
          </button>
        </form>
      ) : (
        <p className={styles.closedNote}>
          {r.status === "closed"
            ? "Обращение закрыто. Если нужна помощь, создайте новое."
            : "В этом обращении набралось много сообщений. Дождитесь ответа или создайте новое обращение."}
        </p>
      )}
    </li>
  );
}
