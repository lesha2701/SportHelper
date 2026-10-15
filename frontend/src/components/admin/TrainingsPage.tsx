import { useEffect, useState } from "react";
import {
  deleteAdminListing,
  getAdminListing,
  getAdminTraining,
  hideAdminListing,
  listAdminListings,
  listAdminTrainings,
  restoreAdminListing,
  type AdminListing,
  type ListingState,
  type TrainingKind,
  type TrainingStatus,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { navigate, useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, errorText, formatDate, formatDateTime, useAdminQuery, useDebounced, useOpenParam } from "./adminUi";
import { StepUpCancelled, useStepUp } from "./stepUp";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<TrainingStatus, string> = { scheduled: "Запланирована", completed: "Проведена", cancelled: "Отменена" };
const KIND_LABELS: Record<TrainingKind, string> = { team: "Командная", personal: "Персональная", independent: "Самостоятельная" };
const LISTING_STATE_LABELS: Record<ListingState, string> = { public: "В каталоге", hidden: "Скрыто модератором", unlisted: "Выключено тренером", deleted: "Удалено" };

export function TrainingsPage() {
  const { path, search } = useLocation();
  const tab = new URLSearchParams(search).get("tab") === "listings" ? "listings" : "trainings";
  const choose = (next: "trainings" | "listings") => navigate(next === "listings" ? `${path}?tab=listings` : path, { replace: true });

  return (
    <>
      <PageHead
        title="Тренировки и объявления"
        hint="Тренировки здесь только для просмотра: их ведут сами команды и тренеры. Модерировать можно объявления тренеров."
      />
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "trainings"} className={tab === "trainings" ? styles.tabActive : styles.tab} onClick={() => choose("trainings")}>
          Тренировки
        </button>
        <button type="button" role="tab" aria-selected={tab === "listings"} className={tab === "listings" ? styles.tabActive : styles.tab} onClick={() => choose("listings")}>
          Объявления тренеров
        </button>
      </div>
      {tab === "trainings" ? <TrainingsTab /> : <ListingsTab />}
    </>
  );
}

// --- trainings --------------------------------------------------------------------------------------------------------

function TrainingsTab() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TrainingStatus | "">("");
  const [type, setType] = useState<TrainingKind | "">("");
  const [when, setWhen] = useState<"upcoming" | "past" | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useOpenParam();
  const q = useDebounced(search);

  useEffect(() => setOffset(0), [q, status, type, when]);
  const { query, reload } = useAdminQuery(() => listAdminTrainings({ q, status, type, when, sort: "date_desc", limit: PAGE_SIZE, offset }), [q, status, type, when, offset]);

  return (
    <>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Описание, место, команда, тренер или ID" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск тренировок" />
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as TrainingStatus | "")} aria-label="Статус тренировки">
          <option value="">Любой статус</option>
          {(Object.keys(STATUS_LABELS) as TrainingStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={type} onChange={(e) => setType(e.target.value as TrainingKind | "")} aria-label="Вид тренировки">
          <option value="">Любой вид</option>
          {(Object.keys(KIND_LABELS) as TrainingKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={when} onChange={(e) => setWhen(e.target.value as "upcoming" | "past" | "")} aria-label="Когда">
          <option value="">Любые даты</option>
          <option value="upcoming">Предстоящие</option>
          <option value="past">Прошедшие</option>
        </select>
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Тренировок не найдено.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Что</th>
                    <th>Тренер / автор</th>
                    <th>Статус</th>
                    <th>Участники</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((t) => (
                    <tr key={t.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(t.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(t.id)}>
                      <td>
                        {formatDate(t.trainingDate)}
                        <div className={styles.muted}>{t.startTime.slice(0, 5)} · {t.durationMinutes} мин</div>
                      </td>
                      <td>
                        <strong>{t.description || KIND_LABELS[t.type]}</strong>
                        <div className={styles.muted}>{[KIND_LABELS[t.type], t.team?.name, t.location].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>
                        {t.creator.name || "—"}
                        <div className={styles.muted}>{t.creator.email}</div>
                      </td>
                      <td>
                        <Pill tone={t.status === "completed" ? "ok" : t.status === "cancelled" ? "bad" : "neutral"}>{STATUS_LABELS[t.status]}</Pill>
                      </td>
                      <td>{t.participants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {openId && <TrainingDrawer trainingId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TrainingDrawer({ trainingId, onClose }: { trainingId: string; onClose: () => void }) {
  const { query, reload } = useAdminQuery(() => getAdminTraining(trainingId), [trainingId]);
  const t = query.status === "ready" ? query.data : null;
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Карточка тренировки">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Тренировка
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {t && (
          <>
            <section className={styles.card}>
              <dl className={styles.kv}>
                <dt>Когда</dt>
                <dd>
                  {formatDate(t.trainingDate)}, {t.startTime.slice(0, 5)} · {t.durationMinutes} мин
                </dd>
                <dt>Вид</dt>
                <dd>
                  {KIND_LABELS[t.type]} {t.recurring && <Pill>повторяется</Pill>}
                </dd>
                <dt>Статус</dt>
                <dd>
                  <Pill tone={t.status === "completed" ? "ok" : t.status === "cancelled" ? "bad" : "neutral"}>{STATUS_LABELS[t.status]}</Pill>
                </dd>
                <dt>Место</dt>
                <dd>{t.location ?? "—"}</dd>
                {t.team && (
                  <>
                    <dt>Команда</dt>
                    <dd>{t.team.name}</dd>
                  </>
                )}
                <dt>Автор</dt>
                <dd>
                  <Link to={`/admin/users?open=${t.creator.id}`} className={styles.link}>
                    {t.creator.name || "Без имени"}
                  </Link>{" "}
                  <span className={styles.muted}>{t.creator.email}</span>
                </dd>
                <dt>План</dt>
                <dd>{t.planName ?? "—"}</dd>
                <dt>Создана</dt>
                <dd>{formatDateTime(t.createdAt)}</dd>
                <dt>Описание</dt>
                <dd style={{ whiteSpace: "pre-line" }}>{t.description ?? "—"}</dd>
              </dl>
            </section>
            <section>
              <h3 className={styles.cardTitle}>Участники ({t.participants})</h3>
              {t.participantList.length === 0 ? (
                <p className={styles.muted}>Отметок посещаемости ещё нет{t.team ? " — на тренировку приходит состав команды" : ""}.</p>
              ) : (
                <ul className={styles.timeline}>
                  {t.participantList.map((p) => (
                    <li key={p.id} className={styles.timelineItem}>
                      {p.name} {p.attendance && <Pill tone={p.attendance === "present" ? "ok" : "warn"}>{p.attendance === "present" ? "был" : "не был"}</Pill>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {t.bookingList.length > 0 && (
              <section>
                <h3 className={styles.cardTitle}>Записи к тренеру</h3>
                <ul className={styles.timeline}>
                  {t.bookingList.map((b) => (
                    <li key={b.id} className={styles.timelineItem}>
                      {b.athlete} → {b.coach} <Pill tone={b.status === "confirmed" ? "ok" : "neutral"}>{b.status}</Pill>
                      <span className={styles.timelineMeta}>
                        {formatDateTime(b.startsAt)} · {b.format === "online" ? "онлайн" : "очно"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// --- listings ---------------------------------------------------------------------------------------------------------

function ListingsTab() {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ListingState | "">("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useOpenParam();
  const q = useDebounced(search);

  useEffect(() => setOffset(0), [q, state]);
  const { query, reload } = useAdminQuery(() => listAdminListings({ q, state, limit: PAGE_SIZE, offset }), [q, state, offset]);

  return (
    <>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Название, тренер (email, имя) или ID" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск объявлений" />
        <select className={styles.select} value={state} onChange={(e) => setState(e.target.value as ListingState | "")} aria-label="Состояние объявления">
          <option value="">Любое состояние</option>
          {(Object.keys(LISTING_STATE_LABELS) as ListingState[]).map((k) => (
            <option key={k} value={k}>
              {LISTING_STATE_LABELS[k]}
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
              <div className={styles.empty}>Объявлений не найдено.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Объявление</th>
                    <th>Тренер</th>
                    <th>Состояние</th>
                    <th>Заявки и записи</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((l) => (
                    <tr key={l.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(l.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(l.id)}>
                      <td>
                        <strong>{l.title}</strong>
                        <div className={styles.muted}>{formatPrice(l)}</div>
                      </td>
                      <td>
                        {l.coach.name || "—"}
                        <div className={styles.muted}>{l.coach.email}</div>
                      </td>
                      <td>
                        <ListingStatePill listing={l} />
                      </td>
                      <td>{l.activeBookings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {openId && <ListingDrawer listingId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function formatPrice(l: AdminListing): string {
  return l.pricePerSession === null ? "цена не указана" : `${l.pricePerSession} ${l.currency}`;
}

function ListingStatePill({ listing }: { listing: AdminListing }) {
  const tone = listing.state === "public" ? "ok" : listing.state === "hidden" ? "bad" : listing.state === "deleted" ? "neutral" : "warn";
  return (
    <>
      <Pill tone={tone}>{LISTING_STATE_LABELS[listing.state]}</Pill>
      {listing.coachBlocked && listing.state !== "deleted" && (
        <>
          {" "}
          <Pill tone="bad">Тренер заблокирован</Pill>
        </>
      )}
    </>
  );
}

type ListingDialog = "hide" | "restore" | "delete" | null;

function ListingDrawer({ listingId, onClose, onChanged }: { listingId: string; onClose: () => void; onChanged: () => void }) {
  const { query, reload } = useAdminQuery(() => getAdminListing(listingId), [listingId]);
  const stepUp = useStepUp();
  const [dialog, setDialog] = useState<ListingDialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      reload();
      onChanged();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const l = query.status === "ready" ? query.data : null;
  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Карточка объявления">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Объявление
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {l && (
          <>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>{l.title}</h3>
              <dl className={styles.kv}>
                <dt>Состояние</dt>
                <dd>
                  <ListingStatePill listing={l} />
                </dd>
                {l.state === "hidden" && (
                  <>
                    <dt>Причина</dt>
                    <dd>
                      {l.moderationReason} <span className={styles.muted}>— {l.hiddenBy ?? "—"}, {formatDateTime(l.hiddenAt)}</span>
                    </dd>
                  </>
                )}
                <dt>Тренер</dt>
                <dd>
                  <Link to={`/admin/users?open=${l.coach.id}`} className={styles.link}>
                    {l.coach.name || "Без имени"}
                  </Link>{" "}
                  <span className={styles.muted}>{l.coach.email}</span>
                </dd>
                <dt>Цена</dt>
                <dd>{formatPrice(l)}</dd>
                <dt>Место</dt>
                <dd>{l.location ?? "—"}</dd>
                <dt>Заявки и записи</dt>
                <dd>{l.activeBookings > 0 ? `${l.activeBookings} (ожидают ответа или ещё впереди)` : "нет"}</dd>
                <dt>Жалобы</dt>
                <dd>
                  {l.openComplaints ? (
                    <Link to={`/admin/reports?q=${l.id}`} className={styles.link}>
                      Открытых: {l.openComplaints}
                    </Link>
                  ) : (
                    "нет открытых"
                  )}
                </dd>
                <dt>Описание</dt>
                <dd style={{ whiteSpace: "pre-line" }}>{l.description ?? "—"}</dd>
              </dl>
            </section>
            {l.state !== "deleted" && (
              <div className={styles.actions}>
                {l.state === "hidden" ? (
                  <button type="button" className={styles.buttonPrimary} onClick={() => { setError(null); setDialog("restore"); }}>
                    Вернуть в каталог
                  </button>
                ) : (
                  <button type="button" className={styles.buttonDanger} onClick={() => { setError(null); setDialog("hide"); }}>
                    Скрыть из каталога
                  </button>
                )}
                <button type="button" className={styles.button} onClick={() => { setError(null); setDialog("delete"); }}>
                  <Icon name="trash" size={15} />
                  Удалить
                </button>
              </div>
            )}
          </>
        )}

        {dialog === "hide" && (
          <ReasonDialog
            title="Скрыть объявление"
            description="Оно пропадёт из каталога, поиска и профиля тренера, новые записи станут невозможны. Уже оформленные записи останутся."
            confirmLabel="Скрыть"
            danger
            busy={busy}
            error={error}
            onConfirm={(reason) => void perform(() => hideAdminListing(listingId, reason))}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "restore" && (
          <ReasonDialog title="Вернуть в каталог" confirmLabel="Вернуть" busy={busy} error={error} onConfirm={(reason) => void perform(() => restoreAdminListing(listingId, reason))} onClose={() => setDialog(null)} />
        )}
        {dialog === "delete" && (
          <ReasonDialog
            title="Удалить объявление"
            description="Удалить можно, только если нет заявок и будущих записей — иначе люди потеряли бы свои занятия. В этом случае скройте объявление."
            confirmLabel="Удалить"
            danger
            busy={busy}
            error={error}
            acknowledge="Я понимаю, что объявление нельзя будет восстановить из панели"
            onConfirm={(reason) => void perform(() => stepUp.run(() => deleteAdminListing(listingId, reason)))}
            onClose={() => setDialog(null)}
          />
        )}
      </aside>
    </div>
  );
}
