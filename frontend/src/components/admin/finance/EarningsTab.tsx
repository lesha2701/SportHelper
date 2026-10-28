import { useState } from "react";
import { holdEarning, listFinanceEarnings, releaseEarning, unholdEarning, type AdminEarning } from "../../../api/adminFinance";
import { ErrorBox, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { EARNING_STATUS_LABELS, money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PAGE_SIZE = 25;

type Pending = { earning: AdminEarning; kind: "release" | "hold" | "unhold" };

export function EarningsTab() {
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const { busy, error, clearError, doing } = useDoing();
  const { query, reload } = useAdminQuery(() => listFinanceEarnings({ status, limit: PAGE_SIZE, offset }), [status, offset]);

  const ask = (earning: AdminEarning, kind: Pending["kind"]) => {
    clearError();
    setPending({ earning, kind });
  };
  const run = (reason: string) => {
    if (!pending) return;
    const { earning, kind } = pending;
    const action = kind === "release" ? () => releaseEarning(earning.id, reason) : kind === "hold" ? () => holdEarning(earning.id, reason) : () => unholdEarning(earning.id, reason);
    void doing(action, () => {
      setPending(null);
      reload();
    });
  };

  return (
    <>
      <div className={styles.chips} role="group" aria-label="Статус начисления">
        {["pending", "held", "available", "reversed", ""].map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => { setStatus(s); setOffset(0); }}>
            {s ? EARNING_STATUS_LABELS[s] : "Все"}
          </button>
        ))}
      </div>
      <p className={styles.pageHint}>
        Деньги тренеру открываются, только когда тренер отметил занятие проведённым и вы подтвердили это. Занятия, которые тренер уже отметил, показаны первыми.
      </p>
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Начислений нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Занятие</th>
                    <th>Тренеру</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.listingTitle ?? "Занятие"}</strong>
                        <div className={styles.muted}>{formatDateTime(e.startsAt)} · {e.athleteFullName} → {e.coachFullName}</div>
                        <div className={styles.muted}>{e.coachEmail}</div>
                      </td>
                      <td>
                        {money(e.trainerKopecks - e.reversedKopecks)}
                        <div className={styles.muted}>из {money(e.grossKopecks)}, комиссия {money(e.platformFeeKopecks)}</div>
                      </td>
                      <td>
                        <Pill tone={e.status === "available" ? "ok" : e.status === "held" ? "bad" : "neutral"}>{EARNING_STATUS_LABELS[e.status] ?? e.status}</Pill>
                        <div className={styles.muted}>
                          {e.sessionConfirmedAt ? `Тренер отметил проведённым ${formatDateTime(e.sessionConfirmedAt)}` : "Тренер ещё не отметил занятие"}
                        </div>
                        {e.heldReason && <div className={styles.muted}>Причина заморозки: {e.heldReason}</div>}
                      </td>
                      <td>
                        <div className={styles.actions}>
                          {e.status === "pending" && (
                            <button type="button" className={styles.buttonPrimary} disabled={!e.sessionConfirmedAt} title={e.sessionConfirmedAt ? undefined : "Тренер ещё не отметил занятие проведённым"} onClick={() => ask(e, "release")}>
                              Открыть тренеру
                            </button>
                          )}
                          {e.status === "pending" && (
                            <button type="button" className={styles.button} onClick={() => ask(e, "hold")}>
                              Заморозить
                            </button>
                          )}
                          {e.status === "held" && (
                            <button type="button" className={styles.button} onClick={() => ask(e, "unhold")}>
                              Снять заморозку
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
      {pending && (
        <ReasonDialog
          title={pending.kind === "release" ? "Открыть деньги тренеру" : pending.kind === "hold" ? "Заморозить начисление" : "Снять заморозку"}
          description={
            pending.kind === "release"
              ? `${money(pending.earning.trainerKopecks)} станут доступны ${pending.earning.coachFullName} к выводу. Убедитесь, что занятие действительно состоялось.`
              : pending.kind === "hold"
                ? "Пока начисление заморожено, его нельзя открыть тренеру. Укажите причину, например спор с игроком."
                : "Начисление снова можно будет открыть тренеру."
          }
          confirmLabel={pending.kind === "release" ? "Открыть" : pending.kind === "hold" ? "Заморозить" : "Снять заморозку"}
          busy={busy}
          error={error}
          onConfirm={run}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
