import { useEffect, useState } from "react";
import { closeAdminMatchRequest, listAdminMatchRequests, takeAdminMatchRequest, type AdminMatchRequest } from "../../api/admin";
import {
  budgetText,
  MATCH_FORMAT_LABELS,
  MATCH_LEVEL_LABELS,
  whenText,
  type MatchStatus,
} from "../../api/matchRequests";
import { ApiError } from "../../api/client";
import { useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDateTime, useAdminQuery, useDebounced } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;

/** What the administrators call a request's state (the author sees softer words). */
export const MATCH_ADMIN_STATUS_LABELS: Record<MatchStatus, string> = { new: "Новая", in_progress: "В работе", closed: "Закрыта", canceled: "Отозвана автором" };

function StatusPill({ status }: { status: MatchStatus }) {
  return <Pill tone={status === "new" ? "bad" : status === "in_progress" ? "warn" : "neutral"}>{MATCH_ADMIN_STATUS_LABELS[status]}</Pill>;
}

/** «Подбор тренера»: the athletes' requests with everything they filled in; an administrator takes one, picks trainers by hand and closes it. */
export function MatchRequestsPage() {
  const { search: urlSearch } = useLocation();
  const [text, setText] = useState(() => new URLSearchParams(urlSearch).get("q") ?? "");
  const [status, setStatus] = useState<MatchStatus | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(text);

  useEffect(() => setOffset(0), [q, status]);
  const { query, reload } = useAdminQuery(() => listAdminMatchRequests({ status, q, limit: PAGE_SIZE, offset }), [status, q, offset]);

  const opened = query.status === "ready" ? (query.data.items.find((r) => r.id === openId) ?? null) : null;

  return (
    <>
      <PageHead
        title="Подбор тренера"
        hint="Заявки спортсменов, которые не нашли тренера в каталоге: сверху те, кто ждёт дольше всех. Возьмите заявку в работу, подберите тренеров вручную и закройте её."
      />
      <div className={styles.chips} role="group" aria-label="Статус заявки">
        {(["", "new", "in_progress", "closed", "canceled"] as const).map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? MATCH_ADMIN_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Вид спорта, город, цель, автор (email, имя, ID)" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск заявок" />
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Заявок нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Что ищет</th>
                    <th>Автор</th>
                    <th>Бюджет</th>
                    <th>Статус</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((r) => (
                    <tr key={r.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                      <td>
                        <strong>{r.sport}</strong>
                        {r.city && <span className={styles.muted}> · {r.city}</span>}
                      </td>
                      <td>{r.author.email ?? r.author.name}</td>
                      <td>{budgetText(r.budgetMin, r.budgetMax, r.currency) ?? "—"}</td>
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
      {opened && <MatchDrawer request={opened} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function MatchDrawer({ request: r, onClose, onChanged }: { request: AdminMatchRequest; onClose: () => void; onChanged: () => void }) {
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = r.status === "new" || r.status === "in_progress";

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setClosing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string | null][] = [
    ["Что хочет прокачать", r.goal],
    ["Уровень", r.level ? MATCH_LEVEL_LABELS[r.level] : null],
    ["Формат", r.format ? MATCH_FORMAT_LABELS[r.format] : null],
    ["Город", r.city],
    ["Бюджет за занятие", budgetText(r.budgetMin, r.budgetMax, r.currency)],
    ["Дни и время", whenText(r.weekdays, r.dayParts)],
    ["Уточнение по времени", r.scheduleNote],
    ["Комментарий", r.comment],
  ];

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Заявка на подбор тренера">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Заявка на подбор
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
            <dt>Автор</dt>
            <dd>
              <Link to={`/admin/users?open=${r.author.id}`} className={styles.link}>
                {r.author.name || "Без имени"}
              </Link>{" "}
              <span className={styles.muted}>{r.author.email}</span>
            </dd>
            <dt>Подана</dt>
            <dd>{formatDateTime(r.createdAt)}</dd>
            <dt>Вид спорта</dt>
            <dd>
              <strong>{r.sport}</strong>
            </dd>
            {facts
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd style={{ whiteSpace: "pre-line" }}>{value}</dd>
                </div>
              ))}
            {r.status !== "new" && r.status !== "canceled" && (
              <>
                <dt>Ведёт</dt>
                <dd>
                  <span className={styles.muted}>{r.handledBy ?? "—"}</span>
                </dd>
              </>
            )}
            {r.adminNote && (
              <>
                <dt>Итог</dt>
                <dd style={{ whiteSpace: "pre-line" }}>{r.adminNote}</dd>
              </>
            )}
          </dl>
        </section>
        {open && (
          <div className={styles.actions}>
            {r.status === "new" && (
              <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void perform(() => takeAdminMatchRequest(r.id))}>
                Взять в работу
              </button>
            )}
            <button type="button" className={styles.button} onClick={() => { setError(null); setClosing(true); }}>
              Закрыть заявку
            </button>
          </div>
        )}
        {error && !closing && <ErrorBox message={error} />}
        {closing && (
          <ReasonDialog
            title="Закрыть заявку"
            description="Коротко запишите итог: кому предложили, почему не нашли. Автор заявку увидит как «Обработана», а эту запись не увидит."
            confirmLabel="Закрыть"
            busy={busy}
            error={error}
            onConfirm={(note) => void perform(() => closeAdminMatchRequest(r.id, note))}
            onClose={() => setClosing(false)}
          />
        )}
      </aside>
    </div>
  );
}
