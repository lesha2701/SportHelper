import { useState } from "react";
import { getMatchCommission, setMatchCommission } from "../../../api/adminFinance";
import { ErrorBox, ReasonDialog, formatDateTime, useAdminQuery } from "../adminUi";
import { useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PERCENT = /^\d{1,3}([.,]\d{1,2})?$/;

/** The platform's share of the FIRST session with a client the platform brought («Подобрать тренера»): the general setting that each new
 * offer copies. It replaces the usual and the personal commission for that one session. An offer keeps the percent it was created with. */
export function MatchCommissionCard() {
  const { query, reload } = useAdminQuery(getMatchCommission, []);
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, error, clearError, doing } = useDoing();

  if (query.status === "error") return <ErrorBox message={query.message} onRetry={reload} />;
  if (query.status === "loading") return <p className={styles.pageHint}>Загрузка процента подбора…</p>;
  const c = query.data;

  const start = () => {
    clearError();
    setProblem(null);
    setPercent(c.percent);
    setOpen(true);
  };
  const confirm = (reason: string) => {
    const typed = percent.trim().replace(",", ".");
    if (!PERCENT.test(percent.trim())) return setProblem("Введите процент числом, например 50 или 37,5.");
    if (Number(typed) > Number(c.maxPercent)) return setProblem(`Процент не может быть больше ${c.maxPercent}%.`);
    if (Number(typed) === Number(c.percent)) return setProblem("Это и так текущий процент.");
    setProblem(null);
    void doing(() => setMatchCommission(typed, reason), () => {
      setOpen(false);
      reload();
    });
  };

  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div className={styles.muted}>Первая тренировка с клиентом из подбора</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{c.percent}%</div>
          <div className={styles.muted}>
            {c.source === "admin" ? "Установлен в этой панели." : `Пока не менялся здесь: действует значение сервера (${c.environmentPercent}%).`} Заменяет обычную и
            личную комиссию для одной записи — первой оплаченной в течение {c.attributionDays} дн. после выбора тренера. Новый процент попадёт только в новые
            предложения: у отправленных он уже зафиксирован.
          </div>
        </div>
        <button type="button" className={styles.button} onClick={start}>
          Изменить процент подбора
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
          title="Изменить процент первой тренировки из подбора"
          description="Новый процент попадёт в предложения, созданные с этого момента. Уже отправленные предложения, созданные оплаты и начисления не меняются."
          confirmLabel="Изменить"
          busy={busy}
          error={problem ?? error}
          acknowledge="Я понимаю, что это изменит доход платформы и долю тренеров с новых предложений"
          extra={
            <label className={styles.field}>
              <span>Новый процент, % (от 0 до {c.maxPercent})</span>
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
