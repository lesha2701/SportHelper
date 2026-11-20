import { useEffect, useState } from "react";
import { listCoachCommissions, setCoachCommission, type CoachCommission } from "../../../api/adminFinance";
import { ErrorBox, Pager, Pill, ReasonDialog, formatDateTime, useAdminQuery, useDebounced } from "../adminUi";
import { useDoing } from "./financeUi";
import styles from "../admin.module.css";

const PAGE_SIZE = 10;
const PERCENT = /^\d{1,2}([.,]\d{1,2})?$/;

type Dialog = { coach: CoachCommission; mode: "set" | "reset" };

/** Personal commissions: find a trainer, give him his own percent (or hand him back to the general one). Like the general commission it
 * applies only to the payments created after the change. */
export function CoachCommissionsCard() {
  const [text, setText] = useState("");
  const [onlyPersonal, setOnlyPersonal] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [percent, setPercent] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const q = useDebounced(text);
  const { busy, error, clearError, doing } = useDoing();
  useEffect(() => setOffset(0), [q, onlyPersonal]);
  const { query, reload } = useAdminQuery(() => listCoachCommissions({ q, onlyPersonal, limit: PAGE_SIZE, offset }), [q, onlyPersonal, offset]);

  const open = (next: Dialog) => {
    clearError();
    setProblem(null);
    setPercent(next.coach.personalPercent ?? "");
    setDialog(next);
  };
  const confirm = (reason: string) => {
    if (!dialog) return;
    let value: string | null = null;
    if (dialog.mode === "set") {
      const typed = percent.trim().replace(",", ".");
      if (!PERCENT.test(percent.trim())) return setProblem("Введите процент числом, например 10 или 7,5.");
      if (query.status === "ready" && Number(typed) > Number(query.data.maxPercent)) return setProblem(`Комиссия не может быть больше ${query.data.maxPercent}%.`);
      if (dialog.coach.personalPercent !== null && Number(typed) === Number(dialog.coach.personalPercent)) return setProblem("У этого тренера и так стоит такая личная комиссия.");
      value = typed;
    }
    setProblem(null);
    void doing(() => setCoachCommission(dialog.coach.coachUserId, value, reason), () => {
      setDialog(null);
      reload();
    });
  };
  const who = (c: CoachCommission) => c.fullName ?? c.email ?? "тренер";

  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <div className={styles.muted}>Личные комиссии тренеров</div>
      <p className={styles.muted} style={{ margin: "4px 0 12px" }}>
        Все тренеры платят общую комиссию. Здесь можно найти тренера и поставить ему свой процент. Он действует только для новых оплат: уже созданные остаются как были.
      </p>
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Имя или email тренера" value={text} maxLength={100} onChange={(e) => setText(e.target.value)} aria-label="Поиск тренера" />
        <button type="button" className={onlyPersonal ? styles.chipActive : styles.chip} aria-pressed={onlyPersonal} onClick={() => setOnlyPersonal((v) => !v)}>
          Только с личным процентом
        </button>
      </div>
      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>{onlyPersonal && !q ? "Личных комиссий пока нет." : "Тренеров не найдено."}</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Тренер</th>
                    <th>Комиссия</th>
                    <th>Кто и когда поставил</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((c) => (
                    <tr key={c.coachUserId}>
                      <td>
                        {c.fullName ?? c.email}
                        {c.fullName && <div className={styles.muted}>{c.email}</div>}
                      </td>
                      <td>
                        <strong>{c.percent}%</strong>{" "}
                        <Pill tone={c.personalPercent !== null ? "warn" : "neutral"}>{c.personalPercent !== null ? "Личная" : "Общая"}</Pill>
                      </td>
                      <td>
                        {c.since ? (
                          <>
                            {formatDateTime(c.since)}, {c.setByEmail ?? "администратор"}
                            <div className={styles.muted}>«{c.reason}»</div>
                          </>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className={styles.button} aria-label={`${c.personalPercent !== null ? "Изменить" : "Задать"} комиссию: ${who(c)}`} onClick={() => open({ coach: c, mode: "set" })}>
                          {c.personalPercent !== null ? "Изменить" : "Задать"}
                        </button>{" "}
                        {c.personalPercent !== null && (
                          <button type="button" className={styles.button} aria-label={`Вернуть общую комиссию: ${who(c)}`} onClick={() => open({ coach: c, mode: "reset" })}>
                            Вернуть общую
                          </button>
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
      {dialog && query.status === "ready" && (
        <ReasonDialog
          title={dialog.mode === "set" ? `Личная комиссия: ${who(dialog.coach)}` : `Вернуть общую комиссию: ${who(dialog.coach)}`}
          description={
            dialog.mode === "set"
              ? `Сейчас тренер платит ${dialog.coach.percent}% (${dialog.coach.personalPercent !== null ? "личная" : "общая"}). Новый процент применится к оплатам, созданным с этого момента.`
              : `Тренер снова будет платить общую комиссию (${query.data.generalPercent}%) с новых оплат. Личный процент (${dialog.coach.personalPercent}%) будет снят.`
          }
          confirmLabel={dialog.mode === "set" ? "Поставить" : "Вернуть общую"}
          busy={busy}
          error={problem ?? error}
          acknowledge="Я понимаю, что это изменит долю тренера и доход платформы с новых оплат"
          extra={
            dialog.mode === "set" ? (
              <label className={styles.field}>
                <span>Личная комиссия, % (от 0 до {query.data.maxPercent})</span>
                <input className={styles.input} inputMode="decimal" value={percent} autoFocus disabled={busy} onChange={(e) => setPercent(e.target.value)} />
              </label>
            ) : undefined
          }
          onConfirm={confirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
