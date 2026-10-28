import { useCallback, useEffect, useState } from "react";
import { cancelWithdrawal, getFinanceSummary, listFinanceOperations, listMyWithdrawals, requestWithdrawal } from "../../api/finance";
import { ApiError } from "../../api/client";
import { formatKopecks, parseRubles } from "../../lib/money";
import {
  CANCELABLE_WITHDRAWAL_STATUSES,
  PAYOUT_METHOD_LABELS,
  WITHDRAWAL_STATUS_LABELS,
  type FinanceOperation,
  type FinanceSummary,
  type Page,
  type PayoutMethod,
  type Withdrawal,
} from "../../types/finance";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./finance.module.css";

const PAGE_SIZE = 10;

const OPERATION_TITLES: Record<string, string> = {
  payment_received: "Оплата занятия получена",
  earning_released: "Средства стали доступны к выводу",
  withdrawal_reserved: "Заявка на вывод создана",
  withdrawal_released: "Заявка на вывод закрыта, деньги вернулись на баланс",
  withdrawal_paid: "Выплата произведена",
  refund: "Возврат игроку",
};

const EARNING_STATUS_LABELS: Record<string, string> = {
  pending: "ждёт проведения занятия",
  held: "приостановлено на проверку",
  available: "доступно",
  reversed: "отменено",
};

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function operationMeta(op: FinanceOperation): string[] {
  const lines: string[] = [];
  if (op.listingTitle) lines.push(op.listingTitle);
  if (op.kind === "payment_received" && op.grossKopecks !== null && op.platformFeeKopecks !== null) {
    lines.push(`Игрок заплатил ${formatKopecks(op.grossKopecks)}, комиссия платформы ${formatKopecks(op.platformFeeKopecks)}`);
  }
  if (op.earningStatus && op.kind === "payment_received") lines.push(`Статус: ${EARNING_STATUS_LABELS[op.earningStatus] ?? op.earningStatus}`);
  if (op.withdrawalStatus) lines.push(`Заявка: ${WITHDRAWAL_STATUS_LABELS[op.withdrawalStatus]}`);
  return lines;
}

export function FinanceScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operations, setOperations] = useState<Page<FinanceOperation> | null>(null);
  const [opOffset, setOpOffset] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Page<Withdrawal> | null>(null);
  const [wdOffset, setWdOffset] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getFinanceSummary(token)
      .then((s) => {
        setSummary(s);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить финансы"));
    listFinanceOperations(token, PAGE_SIZE, opOffset)
      .then(setOperations)
      .catch(() => undefined);
    listMyWithdrawals(token, PAGE_SIZE, wdOffset)
      .then(setWithdrawals)
      .catch(() => undefined);
  }, [token, opOffset, wdOffset]);

  useEffect(refresh, [refresh]);

  const cancel = async (id: string) => {
    setCancelingId(id);
    setActionError(null);
    try {
      await cancelWithdrawal(token, id);
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось отменить заявку");
      refresh();
    } finally {
      setCancelingId(null);
    }
  };

  if (loadError && !summary) return <StateScreen kind="error" title="Не удалось загрузить финансы" description={loadError} />;
  if (!summary) return <StateScreen kind="loading" title="Загрузка финансов…" />;

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <h1 className={profileStyles.pageHeading}>Финансы</h1>

      <div className={styles.balanceGrid}>
        <div className={styles.balanceTilePrimary}>
          <span className={styles.balanceLabel}>Доступно к выводу</span>
          <span className={styles.balanceValuePrimary}>{formatKopecks(summary.availableKopecks)}</span>
        </div>
        <div className={styles.balanceTile}>
          <span className={styles.balanceLabel}>Ожидает проведения занятия</span>
          <span className={styles.balanceValue}>{formatKopecks(summary.pendingKopecks)}</span>
        </div>
        <div className={styles.balanceTile}>
          <span className={styles.balanceLabel}>В обработке (заявки на вывод)</span>
          <span className={styles.balanceValue}>{formatKopecks(summary.reservedKopecks)}</span>
        </div>
        <div className={styles.balanceTile}>
          <span className={styles.balanceLabel}>Выплачено всего</span>
          <span className={styles.balanceValue}>{formatKopecks(summary.paidOutKopecks)}</span>
        </div>
      </div>

      {summary.debtKopecks > 0 && (
        <p className={styles.debtNote}>
          За вами числится задолженность {formatKopecks(summary.debtKopecks)}: по возврату денег игроку, которые уже были выплачены. Администратор свяжется с вами.
        </p>
      )}

      <div className={profileStyles.card}>
        <button type="button" className={profileStyles.buttonPrimary} disabled={!summary.canWithdraw} onClick={() => setFormOpen(true)}>
          Вывести средства
        </button>
        {!summary.withdrawalsEnabled ? (
          <p className={styles.note}>Вывод средств пока недоступен.</p>
        ) : summary.shortfallKopecks > 0 ? (
          <p className={styles.note}>
            Минимальная сумма вывода — {formatKopecks(summary.minimumWithdrawalKopecks)}. Не хватает {formatKopecks(summary.shortfallKopecks)}.
          </p>
        ) : null}
        <p className={styles.note}>
          Деньги за занятие становятся доступными к выводу после того, как вы отметите занятие проведённым и платформа его подтвердит. Комиссия платформы — {summary.commissionPercent}% с каждой оплаты.
          Выплаты выполняются вручную, после проверки заявки.
        </p>
      </div>

      {formOpen && (
        <WithdrawalForm
          token={token}
          summary={summary}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false);
            setWdOffset(0);
            refresh();
          }}
        />
      )}

      <div className={profileStyles.card}>
        <h2 className={styles.sectionTitle}>Заявки на вывод</h2>
        {actionError && <p className={profileStyles.error}>{actionError}</p>}
        {withdrawals && withdrawals.items.length === 0 && <p className={styles.note}>Заявок пока нет.</p>}
        <ul className={styles.list}>
          {withdrawals?.items.map((w) => (
            <li key={w.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{formatKopecks(w.amountKopecks)}</span>
                <span className={styles.itemMeta}>{w.detailsHint}</span>
                <span className={styles.itemMeta}>{formatDateTime(w.createdAt)}</span>
                {w.decidedReason && <span className={styles.itemMeta}>Причина: {w.decidedReason}</span>}
              </div>
              <div className={styles.itemSide}>
                <span className={styles.statusPill}>{WITHDRAWAL_STATUS_LABELS[w.status]}</span>
                {CANCELABLE_WITHDRAWAL_STATUSES.includes(w.status) && (
                  <button type="button" className={styles.linkButton} disabled={cancelingId === w.id} onClick={() => void cancel(w.id)}>
                    Отменить заявку
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {withdrawals && <PagerBar page={withdrawals} onChange={setWdOffset} label="заявок" />}
      </div>

      <div className={profileStyles.card}>
        <h2 className={styles.sectionTitle}>История операций</h2>
        {operations && operations.items.length === 0 && <p className={styles.note}>Операций пока нет. Они появятся после первой оплаты занятия.</p>}
        <ul className={styles.list}>
          {operations?.items.map((op) => (
            <li key={op.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{OPERATION_TITLES[op.kind] ?? "Операция"}</span>
                {operationMeta(op).map((line) => (
                  <span key={line} className={styles.itemMeta}>
                    {line}
                  </span>
                ))}
                <span className={styles.itemMeta}>{formatDateTime(op.createdAt)}</span>
              </div>
              <span className={styles.itemAmount}>{formatKopecks(op.amountKopecks)}</span>
            </li>
          ))}
        </ul>
        {operations && <PagerBar page={operations} onChange={setOpOffset} label="операций" />}
      </div>
    </div>
  );
}

function PagerBar<T>({ page, onChange, label }: { page: Page<T>; onChange: (offset: number) => void; label: string }) {
  if (page.total <= page.limit) return null;
  const from = page.offset + 1;
  const to = Math.min(page.offset + page.limit, page.total);
  return (
    <div className={styles.pager}>
      <button type="button" className={styles.linkButton} disabled={page.offset === 0} onClick={() => onChange(Math.max(0, page.offset - page.limit))}>
        ← Назад
      </button>
      <span>
        {from}–{to} из {page.total} {label}
      </span>
      <button type="button" className={styles.linkButton} disabled={to >= page.total} onClick={() => onChange(page.offset + page.limit)}>
        Дальше →
      </button>
    </div>
  );
}

type Fields = Record<string, string>;

const FIELDS: Record<PayoutMethod, { key: string; label: string; placeholder?: string; inputMode?: "numeric" | "tel"; optional?: boolean }[]> = {
  sbp: [
    { key: "phone", label: "Номер телефона", placeholder: "+7 9XX XXX-XX-XX", inputMode: "tel" },
    { key: "bank", label: "Банк получателя", placeholder: "Например, Сбербанк" },
    { key: "recipient", label: "Получатель (ФИО)" },
  ],
  bank_transfer: [
    { key: "recipient", label: "Получатель (ФИО или название ИП)" },
    { key: "bank", label: "Банк получателя" },
    { key: "bik", label: "БИК (9 цифр)", inputMode: "numeric" },
    { key: "account", label: "Расчётный счёт (20 цифр)", inputMode: "numeric" },
    { key: "inn", label: "ИНН (по желанию)", inputMode: "numeric", optional: true },
  ],
};

function WithdrawalForm({ token, summary, onClose, onCreated }: { token: string; summary: FinanceSummary; onClose: () => void; onCreated: () => void }) {
  // One key per opened form: a double click or a retry after a lost answer can only ever create one request.
  const [clientKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("sbp");
  const [fields, setFields] = useState<Fields>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);

  const fieldError = (field: string) => (error?.field === field ? <span className={profileStyles.error}>{error.message}</span> : null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const kopecks = parseRubles(amount);
    if (kopecks === null) return setError({ field: "amount", message: "Укажите сумму в рублях, не больше двух знаков после запятой." });
    if (kopecks < summary.minimumWithdrawalKopecks) return setError({ field: "amount", message: `Минимальная сумма вывода — ${formatKopecks(summary.minimumWithdrawalKopecks)}.` });
    if (kopecks > summary.availableKopecks) return setError({ field: "amount", message: "Нельзя вывести больше, чем доступно." });
    if (!password) return setError({ field: "password", message: "Введите пароль от аккаунта." });
    const details: Fields = {};
    for (const f of FIELDS[method]) {
      const value = (fields[f.key] ?? "").trim();
      if (value) details[f.key] = value;
      else if (!f.optional) return setError({ field: f.key, message: "Заполните поле." });
    }
    setBusy(true);
    setError(null);
    try {
      await requestWithdrawal(token, { amountKopecks: kopecks, method, details, clientKey, password });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? { field: err.field, message: err.message } : { field: null, message: "Не удалось создать заявку. Попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={profileStyles.card} onSubmit={(e) => void submit(e)} aria-label="Заявка на вывод средств">
      <h2 className={styles.sectionTitle}>Заявка на вывод</h2>
      <p className={styles.note}>
        Укажите, куда перевести деньги. Номер банковской карты не нужен и не принимается — используйте СБП или банковские реквизиты.
      </p>

      <div className={profileStyles.field}>
        <label className={profileStyles.label} htmlFor="wd-amount">
          Сумма, ₽ (доступно {formatKopecks(summary.availableKopecks)})
        </label>
        <input id="wd-amount" className={profileStyles.input} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {fieldError("amount")}
      </div>

      <div className={profileStyles.field}>
        <label className={profileStyles.label} htmlFor="wd-method">
          Способ получения
        </label>
        <select id="wd-method" className={profileStyles.select} value={method} onChange={(e) => { setMethod(e.target.value as PayoutMethod); setError(null); }}>
          {(Object.keys(PAYOUT_METHOD_LABELS) as PayoutMethod[]).map((m) => (
            <option key={m} value={m}>
              {PAYOUT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </div>

      {FIELDS[method].map((f) => (
        <div className={profileStyles.field} key={`${method}-${f.key}`}>
          <label className={profileStyles.label} htmlFor={`wd-${f.key}`}>
            {f.label}
          </label>
          <input
            id={`wd-${f.key}`}
            className={profileStyles.input}
            inputMode={f.inputMode}
            placeholder={f.placeholder}
            autoComplete="off"
            value={fields[f.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
          />
          {fieldError(f.key)}
        </div>
      ))}

      <div className={profileStyles.field}>
        <label className={profileStyles.label} htmlFor="wd-password">
          Пароль от аккаунта (для подтверждения)
        </label>
        <input id="wd-password" className={profileStyles.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {fieldError("password")}
      </div>

      {error && !(error.field && ["amount", "password", ...FIELDS[method].map((f) => f.key)].includes(error.field)) && <p className={profileStyles.error}>{error.message}</p>}

      <div className={profileStyles.formActions}>
        <button type="submit" className={profileStyles.buttonPrimary} disabled={busy}>
          {busy ? "Отправляем…" : "Создать заявку"}
        </button>
        <button type="button" className={profileStyles.buttonSecondary} disabled={busy} onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
