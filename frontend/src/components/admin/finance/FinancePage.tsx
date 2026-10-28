import { useState } from "react";
import {
  getFinanceIntegrity,
  getFinanceOverview,
  listFinanceIncidents,
  listFinanceRefunds,
  resolveFinanceIncident,
  type AdminIncident,
  type AdminRefund,
  type FinanceOverview,
} from "../../../api/adminFinance";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { EarningsTab } from "./EarningsTab";
import { PaymentsTab } from "./PaymentsTab";
import { WithdrawalsTab } from "./WithdrawalsTab";
import { INCIDENT_KIND_LABELS, REFUND_STATUS_LABELS, money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "withdrawals", label: "Выводы" },
  { id: "earnings", label: "Начисления" },
  { id: "payments", label: "Платежи" },
  { id: "refunds", label: "Возвраты" },
  { id: "incidents", label: "Инциденты" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PAGE_SIZE = 25;

export function FinancePage() {
  const [tab, setTab] = useState<TabId>("overview");
  return (
    <>
      <PageHead title="Финансы" hint="Деньги игроков, начисления тренерам и заявки на вывод. Каждое действие требует второго фактора и записывается в журнал. Сайт сам не переводит деньги: выплату делает человек в банке, здесь она только фиксируется." />
      <div className={styles.tabs} role="tablist" aria-label="Разделы финансов">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? styles.tabActive : styles.tab} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab onOpen={setTab} />}
      {tab === "withdrawals" && <WithdrawalsTab />}
      {tab === "earnings" && <EarningsTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "refunds" && <RefundsTab />}
      {tab === "incidents" && <IncidentsTab />}
    </>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className={styles.card}>
      <div className={styles.muted}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone === "bad" ? "var(--color-danger)" : undefined }}>{value}</div>
      {hint && <div className={styles.muted}>{hint}</div>}
    </div>
  );
}

function OverviewTab({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const { query, reload } = useAdminQuery<FinanceOverview>(getFinanceOverview, []);
  const integrity = useAdminQuery(getFinanceIntegrity, []);
  if (query.status === "error") return <ErrorBox message={query.message} onRetry={reload} />;
  if (query.status === "loading") return <p className={styles.pageHint}>Загрузка…</p>;
  const o = query.data;
  const flags: [string, boolean][] = [
    ["Онлайн-оплата", o.flags.payments],
    ["Баланс тренеров", o.flags.trainerBalance],
    ["Вывод средств", o.flags.withdrawals],
    ["Подтверждение выплат", o.flags.payoutConfirmation],
    ["Правило двух администраторов", o.flags.twoPersonRule],
  ];
  return (
    <>
      <div className={styles.chips} aria-label="Что включено">
        {flags.map(([label, on]) => (
          <Pill key={label} tone={on ? "ok" : "neutral"}>
            {label}: {on ? "включено" : "выключено"}
          </Pill>
        ))}
        <Pill>Выпуск начислений: {o.flags.releaseMode === "admin" ? "вручную" : "автоматически после паузы"}</Pill>
      </div>

      <h2 className={styles.cardTitle}>Деньги платформы</h2>
      <div className={styles.grid}>
        <Tile label="Получено от игроков" value={money(o.grossReceivedKopecks)} hint="за вычетом возвратов; это не доход платформы" />
        <Tile label="Комиссия платформы" value={money(o.platformCommissionKopecks)} hint={`${o.commissionPercent}% с каждой оплаты, без возвращённой`} />
        <Tile label="Выплачено тренерам" value={money(o.paidOutKopecks)} />
        <Tile label="Долги тренеров" value={money(o.trainerDebtsKopecks)} tone={o.trainerDebtsKopecks > 0 ? "bad" : undefined} hint="возвраты после выплаты" />
      </div>

      <h2 className={styles.cardTitle}>Что платформа должна тренерам</h2>
      <div className={styles.grid}>
        <Tile label="Ждёт проведения занятия" value={money(o.owedToTrainers.pendingKopecks)} />
        <Tile label="Доступно к выводу" value={money(o.owedToTrainers.availableKopecks)} />
        <Tile label="В заявках на вывод" value={money(o.owedToTrainers.reservedKopecks)} />
        <Tile label="У платёжного сервиса" value={money(o.heldByProviderKopecks)} hint="пока не пришло на счёт" />
      </div>

      <h2 className={styles.cardTitle}>Требует внимания</h2>
      <div className={styles.grid}>
        <button type="button" className={styles.card} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => onOpen("withdrawals")}>
          <div className={styles.muted}>Заявки на вывод в работе</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{o.pendingWithdrawals}</div>
        </button>
        <button type="button" className={styles.card} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => onOpen("earnings")}>
          <div className={styles.muted}>Начислений к проверке</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{o.earnings.pending?.sessionConfirmed ?? 0}</div>
          <div className={styles.muted}>тренер отметил занятие проведённым</div>
        </button>
        <button type="button" className={styles.card} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => onOpen("incidents")}>
          <div className={styles.muted}>Открытые инциденты</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: o.openIncidents > 0 ? "var(--color-danger)" : undefined }}>{o.openIncidents}</div>
        </button>
        <Tile
          label="Сверка книг"
          value={o.ledgerMismatches === 0 && (integrity.query.status !== "ready" || integrity.query.data.balanced) ? "Сходится" : "Расхождение!"}
          tone={o.ledgerMismatches > 0 ? "bad" : undefined}
          hint="остатки счетов пересчитаны по проводкам"
        />
      </div>
      <p className={styles.pageHint}>
        Комиссия ЮKassa и поступления на расчётный счёт сайтом не учитываются — их берут из отчётов ЮKassa и банковской выписки.
      </p>
    </>
  );
}

function RefundsTab() {
  const [offset, setOffset] = useState(0);
  const { query, reload } = useAdminQuery(() => listFinanceRefunds(PAGE_SIZE, offset), [offset]);
  if (query.status === "error") return <ErrorBox message={query.message} onRetry={reload} />;
  if (query.status === "loading") return <p className={styles.pageHint}>Загрузка…</p>;
  const tone = (r: AdminRefund) => (r.status === "succeeded" ? "ok" : r.status === "failed" ? "bad" : "warn");
  return (
    <>
      <div className={styles.tableWrap}>
        {query.data.items.length === 0 ? (
          <div className={styles.empty}>Возвратов не было.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Сумма</th>
                <th>Комиссия / тренеру</th>
                <th>Статус</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>
                    {money(r.amountKopecks)}
                    {r.kind === "duplicate" && <div className={styles.muted}>двойная оплата</div>}
                  </td>
                  <td>
                    {money(r.commissionRefundKopecks)} / {money(r.trainerRefundKopecks)}
                  </td>
                  <td>
                    <Pill tone={tone(r)}>{REFUND_STATUS_LABELS[r.status] ?? r.status}</Pill>
                    {r.failureReason && <div className={styles.muted}>{r.failureReason}</div>}
                  </td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
    </>
  );
}

function IncidentsTab() {
  const [status, setStatus] = useState<"open" | "resolved" | "">("open");
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<AdminIncident | null>(null);
  const { busy, error, clearError, doing } = useDoing();
  const { query, reload } = useAdminQuery(() => listFinanceIncidents(status, PAGE_SIZE, offset), [status, offset]);
  return (
    <>
      <div className={styles.chips} role="group" aria-label="Статус инцидента">
        {(["open", "resolved", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={status === s ? styles.chipActive : styles.chip} aria-pressed={status === s} onClick={() => { setStatus(s); setOffset(0); }}>
            {s === "open" ? "Открытые" : s === "resolved" ? "Закрытые" : "Все"}
          </button>
        ))}
      </div>
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Инцидентов нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Что случилось</th>
                    <th>Подробности</th>
                    <th>Когда</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{INCIDENT_KIND_LABELS[i.kind] ?? i.kind}</strong>
                        <div className={styles.muted}>платёж {i.paymentId ?? "—"}</div>
                      </td>
                      <td style={{ maxWidth: 360, overflowWrap: "anywhere" }}>
                        {i.status === "resolved" ? `Закрыт: ${i.resolution ?? ""}` : typeof i.detail === "string" ? i.detail : JSON.stringify(i.detail)}
                      </td>
                      <td>{formatDateTime(i.createdAt)}</td>
                      <td>
                        {i.status === "open" ? (
                          <button type="button" className={styles.button} onClick={() => { clearError(); setResolving(i); }}>
                            Закрыть
                          </button>
                        ) : (
                          <Pill tone="ok">Закрыт</Pill>
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
      {resolving && (
        <ReasonDialog
          title="Закрыть инцидент"
          description="Опишите, что сделано: например, возврат выполнен или платёж проверен вручную."
          confirmLabel="Закрыть инцидент"
          busy={busy}
          error={error}
          onConfirm={(resolution) => void doing(() => resolveFinanceIncident(resolving.id, resolution), () => { setResolving(null); reload(); })}
          onClose={() => setResolving(null)}
        />
      )}
    </>
  );
}
