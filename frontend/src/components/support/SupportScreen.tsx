import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createSupportRequest,
  listMySupportRequests,
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
              <li key={r.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <strong className={styles.itemSubject}>{r.subject}</strong>
                  <span className={r.status === "answered" ? `${styles.badge} ${styles.badgeAnswered}` : styles.badge}>{SUPPORT_STATUS_LABELS[r.status]}</span>
                </div>
                <span className={styles.itemMeta}>
                  {SUPPORT_KIND_LABELS[r.kind]} · {formatWhen(r.createdAt)}
                </span>
                <p className={styles.itemBody}>{r.body}</p>
                {r.answer && (
                  <div className={styles.answer}>
                    <span className={styles.answerLabel}>Ответ поддержки{r.answeredAt ? ` · ${formatWhen(r.answeredAt)}` : ""}</span>
                    <p className={styles.itemBody}>{r.answer}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
