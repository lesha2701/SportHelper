import { useEffect, useState } from "react";
import {
  listAdminComplaints,
  resolveAdminComplaint,
  takeAdminComplaint,
  type AdminComplaint,
  type ComplaintReason,
  type ComplaintStatus,
  type ComplaintTarget,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDateTime, useAdminQuery, useDebounced } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = { new: "Новая", in_progress: "В работе", resolved: "Решена", rejected: "Отклонена" };
export const COMPLAINT_REASON_LABELS: Record<ComplaintReason, string> = {
  inappropriate: "Недопустимый контент",
  fraud: "Мошенничество",
  spam: "Спам",
  false_info: "Ложная информация",
  other: "Другая причина",
};
const TARGET_LABELS: Record<ComplaintTarget, string> = { user: "Профиль", listing: "Объявление", media: "Фото/видео" };
const STATE_LABELS: Record<string, string> = { active: "активен", blocked: "заблокирован", deleted: "удалён", visible: "на сайте", hidden: "скрыто" };

export function targetLink(target: AdminComplaint["target"]): string {
  if (target.type === "user") return `/admin/users?open=${target.id}`;
  if (target.type === "listing") return `/admin/trainings?tab=listings&open=${target.id}`;
  return `/admin/moderation?open=${target.id}`;
}

function StatusPill({ status }: { status: ComplaintStatus }) {
  return <Pill tone={status === "new" ? "bad" : status === "in_progress" ? "warn" : status === "resolved" ? "ok" : "neutral"}>{COMPLAINT_STATUS_LABELS[status]}</Pill>;
}

export function ComplaintsPage() {
  const { search: urlSearch } = useLocation();
  const [text, setText] = useState(() => new URLSearchParams(urlSearch).get("q") ?? "");
  const [status, setStatus] = useState<ComplaintStatus | "">("");
  const [targetType, setTargetType] = useState<ComplaintTarget | "">("");
  const [reason, setReason] = useState<ComplaintReason | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(text);

  useEffect(() => setOffset(0), [q, status, targetType, reason]);
  const { query, reload } = useAdminQuery(() => listAdminComplaints({ status, targetType, reason, q, limit: PAGE_SIZE, offset }), [status, targetType, reason, q, offset]);

  const opened = query.status === "ready" ? (query.data.items.find((c) => c.id === openId) ?? null) : null;

  return (
    <>
      <PageHead title="Жалобы" hint="Сначала открытые. Примите меры (заблокируйте, скройте) и зафиксируйте решение — оно попадёт в журнал." />
      <div className={styles.chips} role="group" aria-label="Статус жалобы">
        {(["", "new", "in_progress", "resolved", "rejected"] as const).map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? COMPLAINT_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Кто или на кого (email, имя, ID)" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск жалоб" />
        <select className={styles.select} value={targetType} onChange={(e) => setTargetType(e.target.value as ComplaintTarget | "")} aria-label="На что жалоба">
          <option value="">На что угодно</option>
          {(Object.keys(TARGET_LABELS) as ComplaintTarget[]).map((k) => (
            <option key={k} value={k}>
              {TARGET_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={reason} onChange={(e) => setReason(e.target.value as ComplaintReason | "")} aria-label="Причина жалобы">
          <option value="">Любая причина</option>
          {(Object.keys(COMPLAINT_REASON_LABELS) as ComplaintReason[]).map((k) => (
            <option key={k} value={k}>
              {COMPLAINT_REASON_LABELS[k]}
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
              <div className={styles.empty}>Жалоб нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Жалоба</th>
                    <th>На что</th>
                    <th>Причина</th>
                    <th>Статус</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((c) => (
                    <tr key={c.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(c.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(c.id)}>
                      <td>
                        {c.reporter.email ?? c.reporter.name}
                        {c.otherOpenOnTarget > 0 && <div className={styles.muted}>и ещё {c.otherOpenOnTarget} на это же</div>}
                      </td>
                      <td>
                        <strong>{c.target.label ?? "—"}</strong>
                        <div className={styles.muted}>
                          {TARGET_LABELS[c.target.type]}
                          {c.target.state ? ` · ${STATE_LABELS[c.target.state] ?? c.target.state}` : ""}
                        </div>
                      </td>
                      <td>{COMPLAINT_REASON_LABELS[c.reason]}</td>
                      <td>
                        <StatusPill status={c.status} />
                      </td>
                      <td>{formatDateTime(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {opened && <ComplaintDrawer complaint={opened} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function ComplaintDrawer({ complaint: c, onClose, onChanged }: { complaint: AdminComplaint; onClose: () => void; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"resolved" | "rejected" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = c.status === "new" || c.status === "in_progress";

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
      <aside className={styles.drawer} aria-label="Жалоба">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Жалоба
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        <section className={styles.card}>
          <dl className={styles.kv}>
            <dt>Статус</dt>
            <dd>
              <StatusPill status={c.status} />
            </dd>
            <dt>Причина</dt>
            <dd>{COMPLAINT_REASON_LABELS[c.reason]}</dd>
            <dt>Комментарий</dt>
            <dd style={{ whiteSpace: "pre-line" }}>{c.comment ?? "—"}</dd>
            <dt>Пожаловался</dt>
            <dd>
              <Link to={`/admin/users?open=${c.reporter.id}`} className={styles.link}>
                {c.reporter.name || "Без имени"}
              </Link>{" "}
              <span className={styles.muted}>{c.reporter.email}</span>
            </dd>
            <dt>Подана</dt>
            <dd>{formatDateTime(c.createdAt)}</dd>
            <dt>Объект</dt>
            <dd>
              <strong>{c.target.label ?? "—"}</strong> · {TARGET_LABELS[c.target.type]}
              {c.target.state && <> · {STATE_LABELS[c.target.state] ?? c.target.state}</>}
              <div>
                <Link to={targetLink(c.target)} className={styles.link}>
                  Открыть объект и принять меры →
                </Link>
              </div>
            </dd>
            {c.target.owner && (
              <>
                <dt>Чей контент</dt>
                <dd>
                  <Link to={`/admin/users?open=${c.target.owner.id}`} className={styles.link}>
                    {c.target.owner.name || "Без имени"}
                  </Link>{" "}
                  <span className={styles.muted}>{c.target.owner.email}</span>
                </dd>
              </>
            )}
            {c.otherOpenOnTarget > 0 && (
              <>
                <dt>Другие жалобы</dt>
                <dd>
                  <Link to={`/admin/reports?q=${c.target.id}`} className={styles.link}>
                    Ещё открытых на это же: {c.otherOpenOnTarget}
                  </Link>
                </dd>
              </>
            )}
            {!open && (
              <>
                <dt>Решение</dt>
                <dd>
                  {c.resolution} <span className={styles.muted}>— {c.handledBy ?? "—"}, {formatDateTime(c.handledAt)}</span>
                </dd>
              </>
            )}
          </dl>
        </section>
        {open && (
          <div className={styles.actions}>
            {c.status === "new" && (
              <button type="button" className={styles.button} disabled={busy} onClick={() => void perform(() => takeAdminComplaint(c.id))}>
                Взять в работу
              </button>
            )}
            <button type="button" className={styles.buttonPrimary} onClick={() => { setError(null); setDialog("resolved"); }}>
              Решена
            </button>
            <button type="button" className={styles.button} onClick={() => { setError(null); setDialog("rejected"); }}>
              Отклонить
            </button>
          </div>
        )}
        {error && !dialog && <ErrorBox message={error} />}
        {dialog && (
          <ReasonDialog
            title={dialog === "resolved" ? "Жалоба решена" : "Отклонить жалобу"}
            description={dialog === "resolved" ? "Опишите, какие меры приняты." : "Опишите, почему нарушений не найдено."}
            confirmLabel={dialog === "resolved" ? "Закрыть как решённую" : "Отклонить"}
            busy={busy}
            error={error}
            onConfirm={(resolution) => void perform(() => resolveAdminComplaint(c.id, dialog, resolution))}
            onClose={() => setDialog(null)}
          />
        )}
      </aside>
    </div>
  );
}
