import { useEffect, useState } from "react";
import {
  answerAdminSupport,
  closeAdminSupport,
  listAdminSupport,
  takeAdminSupport,
  type AdminSupportRequest,
  type SupportRequestKind,
  type SupportRequestStatus,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { Dialog, ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDateTime, useAdminQuery, useDebounced } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;
const ANSWER_MIN = 3;
const ANSWER_MAX = 3000;

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = { new: "Новое", in_progress: "В работе", answered: "Отвечено", closed: "Закрыто" };
export const SUPPORT_KIND_LABELS: Record<SupportRequestKind, string> = {
  question: "Вопрос",
  suggestion: "Предложение",
  conflict: "Конфликт",
  bug: "Ошибка в работе",
  payment: "Оплата и деньги",
  other: "Другое",
};

function StatusPill({ status }: { status: SupportRequestStatus }) {
  return <Pill tone={status === "new" ? "bad" : status === "in_progress" ? "warn" : status === "answered" ? "ok" : "neutral"}>{SUPPORT_STATUS_LABELS[status]}</Pill>;
}

export function SupportPage() {
  const { search: urlSearch } = useLocation();
  const [text, setText] = useState(() => new URLSearchParams(urlSearch).get("q") ?? "");
  const [status, setStatus] = useState<SupportRequestStatus | "">("");
  const [kind, setKind] = useState<SupportRequestKind | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(text);

  useEffect(() => setOffset(0), [q, status, kind]);
  const { query, reload } = useAdminQuery(() => listAdminSupport({ status, kind, q, limit: PAGE_SIZE, offset }), [status, kind, q, offset]);

  const opened = query.status === "ready" ? (query.data.items.find((r) => r.id === openId) ?? null) : null;

  return (
    <>
      <PageHead title="Поддержка" hint="Обращения пользователей: сначала самые давние открытые. Ответ уходит автору на почту и показывается ему в профиле." />
      <div className={styles.chips} role="group" aria-label="Статус обращения">
        {(["", "new", "in_progress", "answered", "closed"] as const).map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? SUPPORT_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Заголовок, текст, автор (email, имя, ID)" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск обращений" />
        <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value as SupportRequestKind | "")} aria-label="Тип обращения">
          <option value="">Любой тип</option>
          {(Object.keys(SUPPORT_KIND_LABELS) as SupportRequestKind[]).map((k) => (
            <option key={k} value={k}>
              {SUPPORT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Обращений нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Обращение</th>
                    <th>Автор</th>
                    <th>Тип</th>
                    <th>Статус</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((r) => (
                    <tr key={r.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                      <td>
                        <strong>{r.subject}</strong>
                      </td>
                      <td>{r.author.email ?? r.author.name}</td>
                      <td>{SUPPORT_KIND_LABELS[r.kind]}</td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td>{formatDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {opened && <SupportDrawer request={opened} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function SupportDrawer({ request: r, onClose, onChanged }: { request: AdminSupportRequest; onClose: () => void; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"answer" | "close" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = r.status === "new" || r.status === "in_progress";

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Обращение">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Обращение
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        <section className={styles.card}>
          <dl className={styles.kv}>
            <dt>Статус</dt>
            <dd>
              <StatusPill status={r.status} />
            </dd>
            <dt>Тип</dt>
            <dd>{SUPPORT_KIND_LABELS[r.kind]}</dd>
            <dt>Автор</dt>
            <dd>
              <Link to={`/admin/users?open=${r.author.id}`} className={styles.link}>
                {r.author.name || "Без имени"}
              </Link>{" "}
              <span className={styles.muted}>{r.author.email}</span>
            </dd>
            <dt>Подано</dt>
            <dd>{formatDateTime(r.createdAt)}</dd>
            <dt>Заголовок</dt>
            <dd>
              <strong>{r.subject}</strong>
            </dd>
            <dt>Текст</dt>
            <dd style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.body}</dd>
            {r.answer && (
              <>
                <dt>Ответ</dt>
                <dd style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                  {r.answer} <span className={styles.muted}>— {r.handledBy ?? "—"}, {formatDateTime(r.handledAt)}</span>
                </dd>
              </>
            )}
            {r.status === "closed" && (
              <>
                <dt>Закрыто</dt>
                <dd>
                  без ответа <span className={styles.muted}>— {r.handledBy ?? "—"}, {formatDateTime(r.handledAt)}</span>
                </dd>
              </>
            )}
          </dl>
        </section>
        {open && (
          <div className={styles.actions}>
            {r.status === "new" && (
              <button type="button" className={styles.button} disabled={busy} onClick={() => void perform(() => takeAdminSupport(r.id))}>
                Взять в работу
              </button>
            )}
            <button type="button" className={styles.buttonPrimary} onClick={() => { setError(null); setDialog("answer"); }}>
              Ответить
            </button>
            <button type="button" className={styles.button} onClick={() => { setError(null); setDialog("close"); }}>
              Закрыть без ответа
            </button>
          </div>
        )}
        {error && !dialog && <ErrorBox message={error} />}
        {dialog === "answer" && (
          <AnswerDialog request={r} busy={busy} error={error} onSend={(text) => void perform(() => answerAdminSupport(r.id, text))} onClose={() => setDialog(null)} />
        )}
        {dialog === "close" && (
          <ReasonDialog
            title="Закрыть без ответа"
            description="Например: дубль, спам, ответ не требуется. Автору ничего не отправляется."
            confirmLabel="Закрыть"
            busy={busy}
            error={error}
            onConfirm={(note) => void perform(() => closeAdminSupport(r.id, note))}
            onClose={() => setDialog(null)}
          />
        )}
      </aside>
    </div>
  );
}

function AnswerDialog({
  request,
  busy,
  error,
  onSend,
  onClose,
}: {
  request: AdminSupportRequest;
  busy: boolean;
  error: string | null;
  onSend: (answer: string) => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const clean = answer.trim();
  return (
    <Dialog title="Ответить на обращение" onClose={busy ? () => {} : onClose}>
      <p className={styles.dialogText}>
        Ответ получит {request.author.email ?? request.author.name} на почту и увидит его в профиле, в разделе «Поддержка». Отправленный ответ изменить нельзя.
      </p>
      <label className={styles.field}>
        <span>Ответ</span>
        <textarea className={styles.textarea} value={answer} maxLength={ANSWER_MAX} rows={8} autoFocus disabled={busy} onChange={(e) => setAnswer(e.target.value)} />
        <span className={styles.counter}>
          {answer.length} / {ANSWER_MAX}
        </span>
      </label>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button type="button" className={styles.buttonPrimary} disabled={busy || clean.length < ANSWER_MIN} onClick={() => onSend(clean)}>
          {busy ? "…" : "Отправить ответ"}
        </button>
      </div>
    </Dialog>
  );
}
