import { useState } from "react";
import {
  approveWithdrawal,
  getFinanceWithdrawal,
  getPayoutDetails,
  listFinanceWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
  reviewWithdrawal,
  startWithdrawalProcessing,
  type AdminWithdrawal,
  type WithdrawalDetail,
  type WithdrawalState,
} from "../../../api/adminFinance";
import { formatKopecks, parseRubles } from "../../../lib/money";
import { Icon } from "../../shared/Icon";
import { Dialog, ErrorBox, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { WITHDRAWAL_STATUS_LABELS, money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PAGE_SIZE = 25;
const IN_WORK: WithdrawalState[] = ["requested", "under_review", "approved", "processing"];

const FIELD_LABELS: Record<string, string> = { phone: "Телефон (СБП)", bank: "Банк", recipient: "Получатель", bik: "БИК", account: "Расчётный счёт", inn: "ИНН" };

const tone = (status: WithdrawalState) => (status === "paid" ? "ok" : status === "rejected" ? "bad" : status === "canceled" ? "neutral" : "warn");

export function WithdrawalsTab() {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const { query, reload } = useAdminQuery(() => listFinanceWithdrawals({ status, limit: PAGE_SIZE, offset }), [status, offset]);

  return (
    <>
      <div className={styles.chips} role="group" aria-label="Статус заявки">
        {["", "requested", "under_review", "approved", "processing", "paid", "rejected", "canceled"].map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => { setStatus(s); setOffset(0); }}>
            {s ? WITHDRAWAL_STATUS_LABELS[s] : "Все (в работе первыми)"}
          </button>
        ))}
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
                    <th>Тренер</th>
                    <th>Сумма</th>
                    <th>Куда</th>
                    <th>Статус</th>
                    <th>Создана</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((w) => (
                    <tr key={w.id} className={styles.rowClickable} tabIndex={0} onClick={() => setOpenId(w.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(w.id)}>
                      <td>
                        {w.coachFullName}
                        <div className={styles.muted}>{w.coachEmail}</div>
                      </td>
                      <td>{money(w.amountKopecks)}</td>
                      <td>{w.detailsHint}</td>
                      <td>
                        <Pill tone={tone(w.status)}>{WITHDRAWAL_STATUS_LABELS[w.status]}</Pill>
                        {w.attention && <div><Pill tone="bad">Нужно внимание</Pill></div>}
                      </td>
                      <td>{formatDateTime(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {openId && <WithdrawalDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

type Dialogs = "reject" | "paid" | "details" | null;

function WithdrawalDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { query, reload } = useAdminQuery<WithdrawalDetail>(() => getFinanceWithdrawal(id), [id]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const { busy, error, clearError, doing } = useDoing();
  const [details, setDetails] = useState<Record<string, string> | null>(null);

  const refresh = () => {
    reload();
    onChanged();
  };
  const step = (action: () => Promise<unknown>) => void doing(action, refresh);
  const open = (d: Dialogs) => {
    clearError();
    setDialog(d);
  };

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Заявка на вывод">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>Заявка на вывод</h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>
        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {query.status === "ready" && (() => {
          const { withdrawal: w, events, trainerBalances: b } = query.data;
          const inWork = IN_WORK.includes(w.status);
          return (
            <>
              <section className={styles.card}>
                <dl className={styles.kv}>
                  <dt>Статус</dt>
                  <dd><Pill tone={tone(w.status)}>{WITHDRAWAL_STATUS_LABELS[w.status]}</Pill></dd>
                  <dt>Тренер</dt>
                  <dd>{w.coachFullName} <span className={styles.muted}>{w.coachEmail}</span></dd>
                  <dt>Сумма</dt>
                  <dd><strong>{money(w.amountKopecks)}</strong></dd>
                  <dt>Куда</dt>
                  <dd>{w.detailsHint}</dd>
                  <dt>Создана</dt>
                  <dd>{formatDateTime(w.createdAt)}</dd>
                  {w.decidedReason && (<><dt>Причина отказа</dt><dd>{w.decidedReason}</dd></>)}
                  {w.status === "paid" && (
                    <>
                      <dt>Банковский идентификатор</dt>
                      <dd>{w.bankReference}</dd>
                      <dt>Переведено</dt>
                      <dd>{money(w.paidAmountKopecks)} · {formatDateTime(w.paidAt)}</dd>
                    </>
                  )}
                  {w.attention && (<><dt>Внимание</dt><dd>{w.attention}</dd></>)}
                </dl>
              </section>

              <section className={styles.card}>
                <h3 className={styles.cardTitle}>Баланс тренера сейчас</h3>
                <dl className={styles.kv}>
                  <dt>Ждёт занятий</dt>
                  <dd>{money(b.trainerPending)}</dd>
                  <dt>Доступно</dt>
                  <dd>{money(b.trainerAvailable)}</dd>
                  <dt>В заявках</dt>
                  <dd>{money(b.trainerReserved)}</dd>
                  <dt>Долг</dt>
                  <dd>{money(b.trainerDebt)}</dd>
                </dl>
              </section>

              {inWork && (
                <section className={styles.card}>
                  <h3 className={styles.cardTitle}>Реквизиты получателя</h3>
                  {details ? (
                    <dl className={styles.kv}>
                      {Object.entries(details).map(([k, v]) => (
                        <div key={k} style={{ display: "contents" }}>
                          <dt>{FIELD_LABELS[k] ?? k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <>
                      <p className={styles.pageHint}>Полные реквизиты скрыты. Каждый просмотр записывается в журнал.</p>
                      <button type="button" className={styles.button} disabled={busy} onClick={() => void doing(async () => setDetails((await getPayoutDetails(w.id)).details))}>
                        Показать реквизиты
                      </button>
                    </>
                  )}
                </section>
              )}

              {error && !dialog && <ErrorBox message={error} />}
              {inWork && (
                <div className={styles.actions}>
                  {w.status === "requested" && <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => step(() => reviewWithdrawal(w.id))}>Взять на проверку</button>}
                  {w.status === "under_review" && <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => step(() => approveWithdrawal(w.id))}>Одобрить</button>}
                  {w.status === "approved" && <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => step(() => startWithdrawalProcessing(w.id))}>Передать на выплату</button>}
                  {w.status === "processing" && <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => open("paid")}>Подтвердить выплату</button>}
                  <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => open("reject")}>Отклонить</button>
                </div>
              )}
              {w.status === "processing" && (
                <p className={styles.pageHint}>
                  Сайт не переводит деньги. Сначала переведите их вручную в банке, затем нажмите «Подтвердить выплату» и укажите банковский идентификатор операции.
                </p>
              )}

              <section className={styles.card}>
                <h3 className={styles.cardTitle}>История заявки</h3>
                {events.map((e) => (
                  <div key={e.id} className={styles.muted} style={{ padding: "3px 0" }}>
                    {formatDateTime(e.createdAt)} · {e.fromStatus ? `${WITHDRAWAL_STATUS_LABELS[e.fromStatus] ?? e.fromStatus} → ` : ""}
                    {WITHDRAWAL_STATUS_LABELS[e.toStatus] ?? e.toStatus} · {e.actorEmail ?? "тренер"}
                    {e.note ? ` · ${e.note}` : ""}
                  </div>
                ))}
              </section>

              {dialog === "reject" && (
                <ReasonDialog
                  title="Отклонить заявку"
                  description={
                    w.status === "processing"
                      ? "Заявка уже передана на выплату. Отклонять её можно, только если деньги точно НЕ были отправлены."
                      : "Деньги вернутся на доступный баланс тренера, он получит уведомление с причиной."
                  }
                  confirmLabel="Отклонить"
                  danger
                  busy={busy}
                  error={error}
                  acknowledge={w.status === "processing" ? "Подтверждаю: деньги по этой заявке НЕ отправлены" : undefined}
                  onConfirm={(reason) => void doing(() => rejectWithdrawal(w.id, reason, w.status === "processing"), () => { setDialog(null); refresh(); })}
                  onClose={() => setDialog(null)}
                />
              )}
              {dialog === "paid" && <PaidDialog withdrawal={w} busy={busy} error={error} onClose={() => setDialog(null)}
                onConfirm={(body) => void doing(() => markWithdrawalPaid(w.id, body), () => { setDialog(null); refresh(); })} />}
            </>
          );
        })()}
      </aside>
    </div>
  );
}

function PaidDialog({
  withdrawal,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  withdrawal: AdminWithdrawal;
  busy: boolean;
  error: string | null;
  onConfirm: (body: { bankReference: string; paidAmountKopecks: number; paidAt?: string; transferNote?: string }) => void;
  onClose: () => void;
}) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [sure, setSure] = useState(false);
  const kopecks = parseRubles(amount);
  const matches = kopecks === withdrawal.amountKopecks;
  const valid = reference.trim().length >= 5 && matches && sure;
  return (
    <Dialog title="Подтвердить выплату" onClose={busy ? () => {} : onClose}>
      <p className={styles.dialogText}>
        Вы подтверждаете, что перевод на {money(withdrawal.amountKopecks)} уже сделан в банке. Деньги будут списаны с баланса тренера и отмечены выплаченными. Это нельзя отменить.
      </p>
      <label className={styles.field}>
        <span>Банковский идентификатор операции (из выписки или платёжки)</span>
        <input className={styles.input} value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Сумма перевода, ₽ (должна совпасть с заявкой: {formatKopecks(withdrawal.amountKopecks)})</span>
        <input className={styles.input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {amount && !matches && <span className={styles.error}>Сумма не совпадает с заявкой.</span>}
      </label>
      <label className={styles.field}>
        <span>Когда переведено (по желанию)</span>
        <input className={styles.input} type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Заметка (по желанию)</span>
        <input className={styles.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className={styles.ack}>
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} disabled={busy} />
        <span>Деньги действительно отправлены получателю</span>
      </label>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={busy || !valid}
          onClick={() =>
            onConfirm({
              bankReference: reference.trim(),
              paidAmountKopecks: withdrawal.amountKopecks,
              paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
              transferNote: note.trim() || undefined,
            })
          }
        >
          {busy ? "…" : "Подтвердить выплату"}
        </button>
      </div>
    </Dialog>
  );
}
