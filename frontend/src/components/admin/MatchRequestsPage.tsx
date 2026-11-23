import { useEffect, useState } from "react";
import {
  closeAdminMatchRequest,
  createMatchOffer,
  listAdminMatchRequests,
  listMatchCandidates,
  takeAdminMatchRequest,
  withdrawMatchOffer,
  type AdminMatchOffer,
  type AdminMatchRequest,
  type MatchCandidate,
} from "../../api/admin";
import {
  budgetText,
  MATCH_FORMAT_LABELS,
  MATCH_LEVEL_LABELS,
  whenText,
  type MatchOfferStatus,
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
export const MATCH_ADMIN_STATUS_LABELS: Record<MatchStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  matched: "Тренер выбран",
  closed: "Закрыта",
  canceled: "Отозвана автором",
};

/** Where an offer to a trainer stands. */
export const MATCH_OFFER_LABELS: Record<MatchOfferStatus, string> = {
  proposed: "Ждёт ответа тренера",
  coach_accepted: "Тренер согласен, ждём выбор спортсмена",
  coach_declined: "Тренер отказался",
  athlete_accepted: "Спортсмен выбрал",
  athlete_declined: "Спортсмен отказался",
  withdrawn: "Отозвано",
  expired: "Время вышло",
};

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
        {(["", "new", "in_progress", "matched", "closed", "canceled"] as const).map((s) => (
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
  const closable = open || r.status === "matched";

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
        <OffersSection request={r} canOffer={open} onChanged={onChanged} />
        {closable && (
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

const OFFER_TONE: Partial<Record<MatchOfferStatus, "ok" | "warn" | "bad" | "neutral">> = {
  proposed: "warn",
  coach_accepted: "warn",
  athlete_accepted: "ok",
  coach_declined: "bad",
  athlete_declined: "bad",
};

/** The trainers this request was offered to, and (while it is open) a search for more. The percent of the first session is fixed
 *  in each offer from the setting at that moment. */
function OffersSection({ request: r, canOffer, onChanged }: { request: AdminMatchRequest; canOffer: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const q = useDebounced(text);

  useEffect(() => {
    if (!canOffer) return;
    let alive = true;
    listMatchCandidates(r.id, q)
      .then((found) => alive && setCandidates(found))
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [r.id, q, canOffer, r.offers.length]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const waiting = (o: AdminMatchOffer) => o.status === "proposed" || o.status === "coach_accepted";

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Предложения тренерам</h3>
      {r.offers.length === 0 ? (
        <p className={styles.pageHint}>Пока никому не предлагали.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {r.offers.map((o) => (
            <li key={o.id}>
              <strong>{o.coach.name || o.coach.email}</strong> <Pill tone={OFFER_TONE[o.status] ?? "neutral"}>{MATCH_OFFER_LABELS[o.status]}</Pill>
              <div className={styles.muted}>
                Первая тренировка: {o.firstSessionPercent}% · отправлено {formatDateTime(o.createdAt)}
                {o.status === "proposed" && ` · ответить до ${formatDateTime(o.expiresAt)}`}
                {o.status === "coach_accepted" && o.athleteExpiresAt && ` · выбор до ${formatDateTime(o.athleteExpiresAt)}`}
              </div>
              {o.adminMessage && <div className={styles.muted}>Ваше сообщение: {o.adminMessage}</div>}
              {o.coachDeclineReason && <div className={styles.muted}>Причина отказа: {o.coachDeclineReason}</div>}
              {waiting(o) && (
                <button type="button" className={styles.button} disabled={busy} onClick={() => void perform(() => withdrawMatchOffer(o.id))}>
                  Отозвать
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canOffer && (
        <>
          <h3 className={styles.cardTitle} style={{ marginTop: 16 }}>
            Предложить тренера
          </h3>
          <p className={styles.pageHint}>
            Только тренеры, которые включили подбор, с опубликованным объявлением и без блокировки или истории со спортсменом. Тренер увидит анкету без
            имени и контактов.
          </p>
          <input className={styles.input} type="search" placeholder="Имя, вид спорта, специализация" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск тренера" />
          <input className={styles.input} type="text" placeholder="Сообщение тренеру (необязательно)" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} aria-label="Сообщение тренеру" style={{ marginTop: 8 }} />
          {candidates && candidates.length === 0 && <p className={styles.pageHint}>Подходящих тренеров нет.</p>}
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {candidates?.map((c) => (
              <li key={c.coachUserId} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <span>
                  <strong>{c.name}</strong> {c.isPro && <Pill tone="neutral">Pro</Pill>}{" "}
                  <span className={styles.muted}>
                    {[c.sport, c.sameSport ? "тот же вид спорта" : null, c.averageRating !== null ? `★ ${c.averageRating.toFixed(1)} (${c.reviewCount})` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy || c.alreadyOffered}
                  onClick={() => void perform(() => createMatchOffer(r.id, c.coachUserId, message.trim() || null))}
                >
                  {c.alreadyOffered ? "Уже предлагали" : "Предложить"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <ErrorBox message={error} />}
    </section>
  );
}
