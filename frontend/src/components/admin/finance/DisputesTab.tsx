import { useState } from "react";
import { listFinanceDisputes, resolveFinanceDispute, type AdminDispute } from "../../../api/adminFinance";
import { ErrorBox, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { EARNING_STATUS_LABELS, money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PAGE_SIZE = 25;

const KIND_LABELS: Record<AdminDispute["disputeKind"], string> = {
  athlete_no_show: "Игрок не пришёл",
  coach_no_show: "Тренер не пришёл",
  not_conducted: "Тренировка не состоялась",
  other: "Другое",
};

const STATE_LABELS: Record<AdminDispute["state"], string> = {
  disputed: "Ждёт решения",
  resolved_released: "Оплата тренеру",
  resolved_refunded: "Возврат игроку",
};

type Pending = { dispute: AdminDispute; outcome: "release" | "refund" };

/** Disputes about whether a booked session took place: the trainer's earning is frozen until an administrator decides (docs/session-confirmation.md). */
export function DisputesTab() {
  const [openOnly, setOpenOnly] = useState(true);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const { busy, error, clearError, doing } = useDoing();
  const { query, reload } = useAdminQuery(() => listFinanceDisputes({ openOnly, limit: PAGE_SIZE, offset }), [openOnly, offset]);

  const run = (note: string) => {
    if (!pending) return;
    const { dispute, outcome } = pending;
    void doing(() => resolveFinanceDispute(dispute.bookingId, outcome, note), () => {
      setPending(null);
      reload();
    });
  };

  return (
    <>
      <div className={styles.chips} role="group" aria-label="Какие споры показать">
        {[true, false].map((only) => (
          <button key={String(only)} type="button" className={openOnly === only ? styles.chipActive : styles.chip} aria-pressed={openOnly === only}
            onClick={() => { setOpenOnly(only); setOffset(0); }}>
            {only ? "Ждут решения" : "Все"}
          </button>
        ))}
      </div>
      <p className={styles.pageHint}>
        Игрок или тренер сообщили, что занятие не состоялось. Начисление тренеру заморожено и само не откроется. Решение принимается один раз:
        оплата остаётся тренеру — или остаток платежа возвращается игроку.
      </p>
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>{openOnly ? "Открытых споров нет." : "Споров не было."}</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Занятие</th>
                    <th>Что сообщили</th>
                    <th>Деньги</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((d) => (
                    <tr key={d.bookingId}>
                      <td>
                        <strong>{d.listingTitle ?? "Занятие"}</strong>
                        <div className={styles.muted}>
                          {formatDateTime(d.startsAt)} · {d.format === "offline" ? "очно" : "онлайн"} · {d.athleteFullName} → {d.coachFullName ?? "тренер"}
                        </div>
                        <div className={styles.muted}>{d.coachMarkedAt ? `Тренер отметил «проведена» ${formatDateTime(d.coachMarkedAt)}` : "Тренер не отмечал «проведена»"}</div>
                      </td>
                      <td>
                        <strong>{d.disputedByRole === "coach" ? "Тренер" : "Игрок"}: {KIND_LABELS[d.disputeKind] ?? d.disputeKind}</strong>
                        {d.disputeText && <div className={styles.muted}>«{d.disputeText}»</div>}
                        <div className={styles.muted}>{formatDateTime(d.disputedAt)}</div>
                      </td>
                      <td>
                        {d.grossKopecks !== null ? money(d.grossKopecks) : "Не оплачено"}
                        {d.earningStatus && <div className={styles.muted}>Начисление: {EARNING_STATUS_LABELS[d.earningStatus] ?? d.earningStatus}</div>}
                      </td>
                      <td>
                        {d.state === "disputed" ? (
                          <div className={styles.actions}>
                            <button type="button" className={styles.buttonPrimary} onClick={() => { clearError(); setPending({ dispute: d, outcome: "release" }); }}>
                              Оплату тренеру
                            </button>
                            <button type="button" className={styles.button} onClick={() => { clearError(); setPending({ dispute: d, outcome: "refund" }); }}>
                              Вернуть игроку
                            </button>
                          </div>
                        ) : (
                          <>
                            <Pill tone={d.state === "resolved_released" ? "ok" : "neutral"}>{STATE_LABELS[d.state]}</Pill>
                            {d.resolutionNote && <div className={styles.muted}>{d.resolutionNote}</div>}
                            {d.resolvedAt && <div className={styles.muted}>{formatDateTime(d.resolvedAt)}</div>}
                          </>
                        )}
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
          title={pending.outcome === "release" ? "Оплата остаётся тренеру" : "Вернуть деньги игроку"}
          description={
            pending.outcome === "release"
              ? `Заморозка снимается, начисление ${pending.dispute.coachFullName ?? "тренера"} можно будет открыть сразу. Обе стороны получат уведомление.`
              : `Остаток платежа${pending.dispute.grossKopecks !== null ? ` (до ${money(pending.dispute.grossKopecks)})` : ""} вернётся игроку на карту, начисление тренеру снимется. Обе стороны получат уведомление.`
          }
          confirmLabel={pending.outcome === "release" ? "Оплату тренеру" : "Вернуть игроку"}
          danger={pending.outcome === "refund"}
          acknowledge="Решение по спору принимается один раз, изменить его будет нельзя"
          busy={busy}
          error={error}
          onConfirm={run}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
