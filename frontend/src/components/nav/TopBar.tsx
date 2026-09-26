import { useEffect, useRef, useState } from "react";
import type { SearchResult, SearchResultType } from "../../api/search";
import { Icon, type IconName } from "../shared/Icon";
import styles from "./TopBar.module.css";

export interface TopBarCta {
  label: string;
  icon: IconName;
  onClick: () => void;
}

export interface TopBarConfig {
  kicker: string;
  title: string;
  cta?: TopBarCta;
  unreadNotifications?: number;
  onOpenNotifications?: () => void;
  search?: {
    run: (query: string) => Promise<SearchResult[]>;
    onSelect: (result: SearchResult) => void;
  };
}

const RESULT_GROUPS: { type: SearchResultType; label: string; icon: IconName }[] = [
  { type: "team", label: "Команды", icon: "trophy" },
  { type: "player", label: "Игроки", icon: "users" },
  { type: "coach", label: "Тренеры", icon: "award" },
  { type: "training", label: "Тренировки", icon: "calendar" },
  { type: "match", label: "Матчи", icon: "ball" },
  { type: "task", label: "Задания", icon: "clipboard" },
  { type: "exercise", label: "Упражнения", icon: "dumbbell" },
];

const MIN_QUERY_LENGTH = 2;

function formatResultDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function SearchBox({ search }: { search: NonNullable<TopBarConfig["search"]> }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const trimmed = query.trim();

  // Debounced fetch; a stale response (older request id) is dropped so a
  // slow earlier query can't overwrite the results of a newer one.
  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setFailed(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      search
        .run(trimmed)
        .then((found) => {
          if (requestId !== requestIdRef.current) return;
          setResults(found);
          setFailed(false);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setResults(null);
          setFailed(true);
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const choose = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    search.onSelect(result);
  };

  const showPanel = open && trimmed.length >= MIN_QUERY_LENGTH;
  const flat = results ?? [];

  return (
    <div className={styles.searchWrap} ref={rootRef}>
      <div className={styles.search}>
        <Icon name="search" size={17} />
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Поиск по команде, тренерам, заданиям…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === "Enter" && flat[0]) {
              choose(flat[0]);
            }
          }}
        />
        <span className={styles.searchKey}>⌘K</span>
      </div>
      {showPanel && (
        <div className={styles.searchPanel}>
          {failed && <div className={styles.searchEmpty}>Не удалось выполнить поиск</div>}
          {!failed && results === null && <div className={styles.searchEmpty}>Ищем…</div>}
          {!failed && results !== null && results.length === 0 && (
            <div className={styles.searchEmpty}>Ничего не найдено</div>
          )}
          {!failed &&
            results !== null &&
            RESULT_GROUPS.map((group) => {
              const items = results.filter((r) => r.type === group.type);
              if (items.length === 0) return null;
              return (
                <div key={group.type} className={styles.searchGroup}>
                  <div className={styles.searchGroupLabel}>{group.label}</div>
                  {items.map((item) => (
                    <button key={`${item.type}-${item.id}`} type="button" className={styles.searchItem} onClick={() => choose(item)}>
                      <span className={styles.searchItemIcon}>
                        <Icon name={group.icon} size={16} />
                      </span>
                      <span className={styles.searchItemText}>
                        <span className={styles.searchItemTitle}>{item.title}</span>
                        {(item.subtitle || item.onDate) && (
                          <span className={styles.searchItemSub}>
                            {[item.subtitle, formatResultDate(item.onDate)].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Desktop-only page header: section kicker + title, the global search, the notification bell, and the
 * screen's primary action. Persistent chrome next to SideNav, not
 * per-screen content — see AppShell. */
export function TopBar({ kicker, title, cta, unreadNotifications, onOpenNotifications, search }: TopBarConfig) {
  return (
    <div className={styles.bar}>
      <div className={styles.heading}>
        <span className={styles.kicker}>{kicker}</span>
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.spacer} />
      {search && <SearchBox search={search} />}
      <button type="button" className={styles.bell} title="Уведомления" onClick={onOpenNotifications}>
        <Icon name="bell" size={19} />
        {!!unreadNotifications && (
          <span className={styles.bellBadge}>{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
        )}
      </button>
      {cta && (
        <button type="button" className={styles.cta} onClick={cta.onClick}>
          <Icon name={cta.icon} size={16} strokeWidth={2.4} />
          {cta.label}
        </button>
      )}
    </div>
  );
}
