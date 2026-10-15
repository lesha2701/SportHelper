import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import styles from "./admin.module.css";

/** Lets any admin page ask the shell to re-check the administrator's access (the server may have revoked it). */
export const AdminContext = createContext<{ recheck: () => void }>({ recheck: () => {} });

export type Query<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Loads data for an admin page. A 401/403 means the access was taken away (or the code expired): the shell
 * re-checks and shows the right gate instead of a confusing empty page. */
export function useAdminQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): { query: Query<T>; reload: () => void } {
  const { recheck } = useContext(AdminContext);
  const [query, setQuery] = useState<Query<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    setQuery((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    fetcher()
      .then((data) => {
        if (ticket === latest.current) setQuery({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) recheck();
        setQuery({ status: "error", message: errorText(error) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { query, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Не удалось выполнить запрос. Попробуйте ещё раз.";
}

export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className={styles.pageHead}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {hint && <p className={styles.pageHint}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={styles.error} role="alert">
      {message}{" "}
      {onRetry && (
        <button type="button" className={styles.button} onClick={onRetry} style={{ marginLeft: 8, height: 28 }}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const cls = tone === "ok" ? styles.pillOk : tone === "warn" ? styles.pillWarn : tone === "bad" ? styles.pillBad : styles.pill;
  return <span className={cls}>{children}</span>;
}

export function Pager({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return total > 0 ? <div className={styles.pager}>Всего: {total}</div> : null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className={styles.pager}>
      <span>
        {from}–{to} из {total}
      </span>
      <span className={styles.actions}>
        <button type="button" className={styles.button} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Назад
        </button>
        <button type="button" className={styles.button} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Далее
        </button>
      </span>
    </div>
  );
}

const DATE_TIME = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DATE_ONLY = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? DATE_TIME.format(new Date(iso)) : "—";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? DATE_ONLY.format(new Date(iso)) : "—";
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

/** Search boxes wait for a pause in typing so a query is not sent per keystroke. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
