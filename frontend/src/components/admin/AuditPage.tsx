import { Fragment, useEffect, useState } from "react";
import { listAdminAudit, type AuditEntry } from "../../api/admin";
import { Link } from "../Link";
import { ErrorBox, PageHead, Pager, Pill, formatDateTime, useAdminQuery, useDebounced } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 50;

export const AUDIT_ACTIONS: Record<string, string> = {
  ban: "Блокировка пользователя",
  unban: "Снятие блокировки",
  media_hide: "Файл скрыт",
  media_restore: "Файл восстановлен",
  media_delete: "Файл удалён",
  media_storage_cleanup: "Очистка хранилища",
  listing_hide: "Объявление скрыто",
  listing_restore: "Объявление восстановлено",
  listing_delete: "Объявление удалено",
  complaint_take: "Жалоба взята в работу",
  complaint_resolved: "Жалоба решена",
  complaint_rejected: "Жалоба отклонена",
  mfa_enabled: "Включена двухфакторная защита",
  mfa_disabled: "Отключена двухфакторная защита",
};

const TARGET_LABELS: Record<string, string> = { user: "Пользователь", media: "Файл", listing: "Объявление", complaint: "Жалоба" };
const RESULT_LABELS = { success: "выполнено", denied: "отказано", failed: "ошибка" } as const;

function targetHref(entry: AuditEntry): string | null {
  if (!entry.targetId) return null;
  if (entry.targetType === "user") return `/admin/users?open=${entry.targetId}`;
  if (entry.targetType === "media") return `/admin/moderation?open=${entry.targetId}`;
  if (entry.targetType === "listing") return `/admin/trainings?tab=listings&open=${entry.targetId}`;
  if (entry.targetType === "complaint") return `/admin/reports?q=${entry.targetId}`;
  return null;
}

function Facts({ title, data }: { title: string; data: unknown }) {
  if (!data || typeof data !== "object") return null;
  return (
    <div>
      <strong>{title}</strong>
      <dl className={styles.kv} style={{ marginTop: 6 }}>
        {Object.entries(data as Record<string, unknown>).map(([key, value]) => (
          <Fragment key={key}>
            <dt>{key}</dt>
            <dd>{value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [result, setResult] = useState<"success" | "denied" | "failed" | "">("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useDebounced(search);

  useEffect(() => setOffset(0), [q, action, targetType, result]);
  const { query, reload } = useAdminQuery(() => listAdminAudit({ action, targetType, result, q, limit: PAGE_SIZE, offset }), [action, targetType, result, q, offset]);

  return (
    <>
      <PageHead title="Журнал действий" hint="Кто, что, над чем и почему. Записи нельзя изменить или удалить — ни из панели, ни из базы." />
      <div className={styles.toolbar}>
        <input className={styles.input} type="search" placeholder="Администратор, причина или ID объекта" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск по журналу" />
        <select className={styles.select} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Действие">
          <option value="">Все действия</option>
          {Object.entries(AUDIT_ACTIONS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={targetType} onChange={(e) => setTargetType(e.target.value)} aria-label="Объект">
          <option value="">Любой объект</option>
          {Object.entries(TARGET_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={result} onChange={(e) => setResult(e.target.value as typeof result)} aria-label="Результат">
          <option value="">Любой результат</option>
          {Object.entries(RESULT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
      {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
      {query.status === "ready" && (
        <>
          <div className={styles.tableWrap}>
            {query.data.items.length === 0 ? (
              <div className={styles.empty}>Записей нет.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Кто</th>
                    <th>Действие</th>
                    <th>Объект</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((entry) => {
                    const href = targetHref(entry);
                    const open = expanded === entry.id;
                    return (
                      <Fragment key={entry.id}>
                        <tr className={styles.rowClickable} tabIndex={0} aria-expanded={open} onClick={() => setExpanded(open ? null : entry.id)} onKeyDown={(e) => e.key === "Enter" && setExpanded(open ? null : entry.id)}>
                          <td>{formatDateTime(entry.createdAt)}</td>
                          <td>{entry.admin}</td>
                          <td>
                            <strong>{AUDIT_ACTIONS[entry.action] ?? entry.action}</strong>
                            {entry.reason && <div className={styles.muted}>{entry.reason}</div>}
                          </td>
                          <td>
                            {entry.targetType ? TARGET_LABELS[entry.targetType] ?? entry.targetType : "—"}
                            {entry.targetId && (
                              <div className={styles.mono}>
                                {href ? (
                                  <Link to={href} className={styles.link} onClick={(e) => e.stopPropagation()}>
                                    {entry.targetId.slice(0, 8)}…
                                  </Link>
                                ) : (
                                  entry.targetId.slice(0, 8)
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            <Pill tone={entry.result === "success" ? "ok" : entry.result === "denied" ? "warn" : "bad"}>{RESULT_LABELS[entry.result]}</Pill>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={5}>
                              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                                <Facts title="До" data={entry.details?.before} />
                                <Facts title="После" data={entry.details?.after} />
                                <Facts title="Дополнительно" data={Object.fromEntries(Object.entries(entry.details ?? {}).filter(([k]) => k !== "before" && k !== "after"))} />
                                {!entry.details && <span className={styles.muted}>Подробностей нет.</span>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}
    </>
  );
}
