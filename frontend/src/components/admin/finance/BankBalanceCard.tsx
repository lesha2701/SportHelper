import { useState } from "react";
import { enterBankBalance, getBankBalance } from "../../../api/adminFinance";
import { formatKopecks, parseRubles } from "../../../lib/money";
import { Dialog, ErrorBox, formatDateTime, useAdminQuery } from "../adminUi";
import { money, useDoing } from "./financeUi";
import styles from "../admin.module.css";

/** «0» is a valid balance of an empty account; parseRubles refuses it because no price or payout may be zero. */
const parseBalance = (text: string): number | null => (/^0+([.,]0{1,2})?$/.test(text.trim()) ? 0 : parseRubles(text));

function Tile({ label, value, hint, bad }: { label: string; value: string; hint: string; bad?: boolean }) {
  return (
    <div className={styles.card}>
      <div className={styles.muted}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: bad ? "var(--color-danger)" : undefined }}>{value}</div>
      <div className={styles.muted}>{hint}</div>
    </div>
  );
}

/** The settlement account: the balance a person copied from the bank, split into the trainers' money (exact, by the books) and ours (the
 * rest). The commission of ЮKassa comes off our part only, so the trainers' part is never an estimate. */
export function BankBalanceCard() {
  const { query, reload } = useAdminQuery(getBankBalance, []);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, error, clearError, doing } = useDoing();

  if (query.status === "error") return <ErrorBox message={query.message} onRetry={reload} />;
  if (query.status === "loading") return <p className={styles.pageHint}>Загрузка…</p>;
  const { latest, trainersNowKopecks } = query.data;

  const start = () => {
    clearError();
    setProblem(null);
    setAmount(latest ? String(latest.balanceKopecks / 100).replace(".", ",") : "");
    setNote("");
    setOpen(true);
  };
  const save = () => {
    const kopecks = parseBalance(amount);
    if (kopecks === null) return setProblem("Введите сумму в рублях, например 125 000 или 125000,50.");
    setProblem(null);
    void doing(() => enterBankBalance(kopecks, note.trim()), () => {
      setOpen(false);
      reload();
    });
  };
  const moved = latest ? trainersNowKopecks - latest.trainersKopecks : 0;

  return (
    <>
      {latest ? (
        <>
          <div className={styles.grid}>
            <Tile label="На счёте (по выписке)" value={money(latest.balanceKopecks)} hint="остаток, который ввёл администратор" />
            <Tile label="Деньги тренеров" value={money(latest.trainersKopecks)} hint="точно, по книгам на момент ввода: ждут занятия, доступны и в заявках на вывод" />
            <Tile
              label="Наши деньги"
              value={money(latest.oursKopecks)}
              hint={latest.oursKopecks < 0 ? "на счёте меньше, чем должны тренерам!" : "всё остальное на счёте; комиссия ЮKassa уже учтена в остатке"}
              bad={latest.oursKopecks < 0}
            />
          </div>
          <p className={styles.pageHint}>
            Введено {formatDateTime(latest.createdAt)}{latest.enteredByEmail ? `, ${latest.enteredByEmail}` : ""}{latest.note ? `: «${latest.note}»` : ""}.{" "}
            {moved !== 0
              ? `С тех пор тренерам стали должны на ${formatKopecks(Math.abs(moved))} ${moved > 0 ? "больше" : "меньше"} (сейчас ${formatKopecks(trainersNowKopecks)}): обновите остаток, чтобы цифры совпали.`
              : "С тех пор тренерские деньги не менялись."}
          </p>
        </>
      ) : (
        <p className={styles.pageHint}>
          Остаток расчётного счёта сайт не видит. Введите его из выписки или кабинета банка, и здесь появится, сколько на счёте тренерских денег (это точная цифра) и сколько наших.
          Сейчас тренерам должны {formatKopecks(trainersNowKopecks)}.
        </p>
      )}
      <button type="button" className={styles.button} onClick={start}>
        {latest ? "Обновить остаток" : "Ввести остаток"}
      </button>
      {open && (
        <Dialog title="Остаток расчётного счёта" onClose={busy ? () => {} : () => setOpen(false)}>
          <p className={styles.dialogText}>
            Возьмите остаток из выписки или кабинета банка. Деньги это не двигает: сайт только запоминает цифру и делит её на тренерские деньги и наши.
          </p>
          <label className={styles.field}>
            <span>Остаток на счёте, ₽</span>
            <input className={styles.input} inputMode="decimal" value={amount} autoFocus disabled={busy} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Пометка (необязательно): откуда цифра, на какое время</span>
            <input className={styles.input} value={note} maxLength={500} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </label>
          {(problem ?? error) && <p className={styles.dialogText} role="alert" style={{ color: "var(--color-danger)" }}>{problem ?? error}</p>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.buttonPrimary} disabled={busy || !amount.trim()} onClick={save}>
              {busy ? "…" : "Сохранить"}
            </button>
            <button type="button" className={styles.buttonGhost} disabled={busy} onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
