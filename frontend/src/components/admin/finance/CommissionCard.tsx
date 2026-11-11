import { useState } from "react";
import { getCommission, setCommission } from "../../../api/adminFinance";
import { ErrorBox, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PERCENT = /^\d{1,2}([.,]\d{1,2})?$/;

/** The platform's commission: what applies now, where it comes from, how to change it and who changed it before. A change applies only to
 * the payments created after it; every payment keeps the percent it was created with. */
export function CommissionCard({ onChanged }: { onChanged: () => void }) {
  const { query, reload } = useAdminQuery(getCommission, []);
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, error, clearError, doing } = useDoing();

  if (query.status === "error") return <ErrorBox message={query.message} onRetry={reload} />;
  if (query.status === "loading") return <p className={styles.pageHint}>Загрузка комиссии…</p>;
  const c = query.data;

  const start = () => {
    clearError();
    setProblem(null);
    setPercent(c.percent);
    setOpen(true);
  };
  const confirm = (reason: string) => {
    const typed = percent.trim().replace(",", ".");
    if (!PERCENT.test(percent.trim())) return setProblem("Введите процент числом, например 10 или 7,5.");
    if (Number(typed) > Number(c.maxPercent)) return setProblem(`Комиссия не может быть больше ${c.maxPercent}%.`);
    if (Number(typed) === Number(c.percent)) return setProblem("Это и так текущая комиссия.");
    setProblem(null);
    void doing(() => setCommission(typed, reason), () => {
      setOpen(false);
      reload();
      onChanged();
    });
  };

  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div className={styles.muted}>Комиссия платформы</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{c.percent}%</div>
          <div className={styles.muted}>
            {c.source === "admin" ? "Установлена в этой панели." : `Пока не менялась здесь: действует значение сервера (${c.environmentPercent}%).`} Меняет только новые оплаты:
            уже созданные остаются с тем процентом, с которым были созданы.
          </div>
        </div>
        <button type="button" className={styles.button} onClick={start}>
          Изменить комиссию
        </button>
      </div>
      {c.history.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>История изменений ({c.history.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {c.history.map((h) => (
              <li key={h.id} className={styles.muted}>
                {formatDateTime(h.createdAt)}: {h.previous ?? "?"}% → <strong>{h.percent}%</strong>, {h.changedByEmail ?? "администратор"}. «{h.reason}»
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && (
        <ReasonDialog
          title="Изменить комиссию платформы"
          description="Новый процент применится к оплатам, созданным с этого момента. Уже созданные оплаты, начисления, возвраты и выплаты не меняются."
          confirmLabel="Изменить"
          busy={busy}
          error={problem ?? error}
          acknowledge="Я понимаю, что это изменит доход платформы и долю тренеров с новых оплат"
          extra={
            <label className={styles.field}>
              <span>Новая комиссия, % (от 0 до {c.maxPercent})</span>
              <input className={styles.input} inputMode="decimal" value={percent} autoFocus disabled={busy} onChange={(e) => setPercent(e.target.value)} />
            </label>
          }
          onConfirm={confirm}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
