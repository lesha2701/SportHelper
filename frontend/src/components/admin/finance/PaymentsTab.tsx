import { useEffect, useState } from "react";
import { getFinancePayment, listFinancePayments, refundPayment, type PaymentDetail } from "../../../api/adminFinance";
import { Icon } from "../../shared/Icon";
import { formatKopecks, parseRubles } from "../../../lib/money";
import { ErrorBox, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery, useDebounced } from "../adminUi";
import { INCIDENT_KIND_LABELS, PAYMENT_STATUS_LABELS, REFUND_STATUS_LABELS, money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PAGE_SIZE = 25;

export function PaymentsTab() {
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(text);
  useEffect(() => setOffset(0), [q, status]);
  const { query, reload } = useAdminQuery(() => listFinancePayments({ status, q, limit: PAGE_SIZE, offset }), [status, q, offset]);

  return (
    <>
      <div className={styles.chips} role="group" aria-label="Статус платежа">
        {["", "awaiting", "paid", "partially_refunded", "refunded"].map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? PAYMENT_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Email игрока или тренера, ID платежа или брони" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск платежей" />
      </div>
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Платежей нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Игрок → тренер</th>
                    <th>Сумма</th>
                    <th>Комиссия</th>
                    <th>Статус</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((p) => (
                    <tr key={p.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(p.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(p.id)}>
                      <td>
                        {p.payerEmail}
                        <div className={styles.muted}>→ {p.coachEmail}</div>
                      </td>
                      <td>{money(p.grossKopecks)}</td>
                      <td>
                        {money(p.platformFeeKopecks)} <span className={styles.muted}>({p.commissionPercent}%)</span>
                      </td>
                      <td>
                        <Pill tone={p.status === "paid" ? "ok" : p.status === "awaiting" ? "warn" : "neutral"}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Pill>
                        {p.openIncidents > 0 && <div><Pill tone="bad">Инцидент</Pill></div>}
                      </td>
                      <td>{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {openId && <PaymentDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function PaymentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { query, reload } = useAdminQuery<PaymentDetail>(() => getFinancePayment(id), [id]);
  const [refunding, setRefunding] = useState<{ attemptId?: string } | null>(null);
  const [amount, setAmount] = useState("");
  const { busy, error, clearError, doing } = useDoing();

  const refresh = () => {
    reload();
    onChanged();
  };

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Платёж">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>Платёж</h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {query.status === "ready" && (() => {
          const { payment: p, attempts, refunds, incidents, earning, postings } = query.data;
          const refundable = Math.max(p.grossKopecks - p.refundedKopecks - p.refundReservedKopecks, 0);
          const startRefund = (attemptId?: string) => {
            clearError();
            setAmount(formatKopecks(refundable).replace(/[^\d,]/g, ""));
            setRefunding({ attemptId });
          };
          return (
            <>
              <section className={styles.card}>
                <dl className={styles.kv}>
                  <dt>Статус</dt>
                  <dd><Pill tone={p.status === "paid" ? "ok" : "neutral"}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Pill></dd>
                  <dt>Занятие</dt>
                  <dd>{p.listingTitle ?? "—"} · {formatDateTime(p.startsAt)}</dd>
                  <dt>Игрок</dt>
                  <dd>{p.payerEmail}</dd>
                  <dt>Тренер</dt>
                  <dd>{p.coachEmail}</dd>
                  <dt>Сумма</dt>
                  <dd>{money(p.grossKopecks)}</dd>
                  <dt>Комиссия ({p.commissionPercent}%)</dt>
                  <dd>{money(p.platformFeeKopecks)}</dd>
                  <dt>Тренеру</dt>
                  <dd>{money(p.trainerKopecks)}</dd>
                  <dt>Возвращено</dt>
                  <dd>{money(p.refundedKopecks)}{p.refundReservedKopecks > 0 && <> · в обработке {money(p.refundReservedKopecks)}</>}</dd>
                  <dt>Оплачен</dt>
                  <dd>{formatDateTime(p.paidAt)}</dd>
                </dl>
              </section>

              {earning && (
                <section className={styles.card}>
                  <h3 className={styles.cardTitle}>Начисление тренеру</h3>
                  <dl className={styles.kv}>
                    <dt>Статус</dt>
                    <dd>{earning.status}</dd>
                    <dt>Занятие отмечено проведённым</dt>
                    <dd>{formatDateTime(earning.sessionConfirmedAt)}</dd>
                    <dt>Выпущено</dt>
                    <dd>{formatDateTime(earning.releasedAt)}</dd>
                  </dl>
                </section>
              )}

              <section className={styles.card}>
                <h3 className={styles.cardTitle}>Попытки оплаты</h3>
                {attempts.map((a) => (
                  <div key={a.id} style={{ padding: "6px 0" }}>
                    <Pill tone={a.status === "succeeded" ? "ok" : a.status === "duplicate_paid" ? "bad" : "neutral"}>{a.status}</Pill>{" "}
                    <span className={styles.muted}>{a.providerPaymentId ?? "ещё не создан в ЮKassa"} · {formatDateTime(a.createdAt)}</span>
                    {a.status === "duplicate_paid" && (
                      <div>
                        <button type="button" className={styles.buttonDanger} onClick={() => startRefund(a.id)}>
                          Вернуть двойную оплату
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </section>

              {incidents.length > 0 && (
                <section className={styles.card}>
                  <h3 className={styles.cardTitle}>Инциденты</h3>
                  {incidents.map((i) => (
                    <div key={i.id}>
                      <Pill tone={i.status === "open" ? "bad" : "ok"}>{i.status === "open" ? "Открыт" : "Закрыт"}</Pill> {INCIDENT_KIND_LABELS[i.kind] ?? i.kind}
                    </div>
                  ))}
                </section>
              )}

              {refunds.length > 0 && (
                <section className={styles.card}>
                  <h3 className={styles.cardTitle}>Возвраты</h3>
                  {refunds.map((r) => (
                    <div key={r.id} style={{ padding: "4px 0" }}>
                      {money(r.amountKopecks)} · {REFUND_STATUS_LABELS[r.status] ?? r.status} · {formatDateTime(r.createdAt)}
                      <div className={styles.muted}>{r.reason}</div>
                    </div>
                  ))}
                </section>
              )}

              <section className={styles.card}>
                <h3 className={styles.cardTitle}>Проводки</h3>
                {postings.map((t) => (
                  <div key={t.id} className={styles.muted}>{formatDateTime(t.createdAt)} · {t.kind}</div>
                ))}
              </section>

              {refundable > 0 && p.paidAt && (
                <div className={styles.actions}>
                  <button type="button" className={styles.buttonDanger} onClick={() => startRefund()}>
                    Вернуть деньги игроку
                  </button>
                </div>
              )}

              {refunding && (
                <ReasonDialog
                  title={refunding.attemptId ? "Вернуть двойную оплату" : "Вернуть деньги игроку"}
                  description={`Можно вернуть не больше ${money(refundable)}. Деньги возвращает ЮKassa на карту, с которой платил игрок; в книгах возврат появится, когда ЮKassa его подтвердит.`}
                  confirmLabel="Вернуть деньги"
                  danger
                  busy={busy}
                  error={error}
                  acknowledge="Я понимаю, что возврат нельзя отменить"
                  extra={
                    <label className={styles.field}>
                      <span>Сумма возврата, ₽</span>
                      <input className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </label>
                  }
                  onConfirm={(reason) => {
                    const kopecks = parseRubles(amount);
                    if (kopecks === null) return;
                    void doing(
                      () => refundPayment(p.id, { amountKopecks: kopecks, reason, attemptId: refunding.attemptId }),
                      () => {
                        setRefunding(null);
                        refresh();
                      },
                    );
                  }}
                  onClose={() => setRefunding(null)}
                />
              )}
            </>
          );
        })()}
      </aside>
    </div>
  );
}
