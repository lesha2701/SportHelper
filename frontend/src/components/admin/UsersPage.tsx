import { useEffect, useState } from "react";
import {
  banAdminUser,
  getAdminUser,
  listAdminUsers,
  unbanAdminUser,
  type AdminUserCard,
  type AdminUserRow,
  type UserRoleFilter,
  type UserSort,
  type UserStatus,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { Icon } from "../shared/Icon";
import { ErrorBox, PageHead, Pager, Pill, ReasonDialog, formatDate, formatDateTime, useAdminQuery, useDebounced, useOpenParam, errorText } from "./adminUi";
import styles from "./admin.module.css";

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<UserStatus, string> = { active: "Активен", banned: "Заблокирован", unverified: "Email не подтверждён", deleted: "Удалён" };
const ROLE_LABELS: Record<UserRoleFilter, string> = { player: "Игроки", coach: "Тренеры", none: "Без роли", admin: "Администраторы" };
const SORT_LABELS: Record<UserSort, string> = {
  created_desc: "Сначала новые",
  created_asc: "Сначала старые",
  active_desc: "Недавно активные",
  active_asc: "Давно не заходили",
};
const BLOCK_DURATIONS: { label: string; days: number | null }[] = [
  { label: "1 день", days: 1 },
  { label: "3 дня", days: 3 },
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
  { label: "90 дней", days: 90 },
  { label: "Бессрочно", days: null },
];

export function fullName(user: { firstName: string; lastName: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

function StatusPill({ user }: { user: Pick<AdminUserRow, "status" | "bannedUntil" | "deletionRequested"> }) {
  const tone = user.status === "active" ? "ok" : user.status === "banned" ? "bad" : user.status === "unverified" ? "warn" : "neutral";
  return (
    <>
      <Pill tone={tone}>{STATUS_LABELS[user.status]}</Pill>
      {user.status === "banned" && <span className={styles.muted}> {user.bannedUntil ? `до ${formatDate(user.bannedUntil)}` : "бессрочно"}</span>}
      {user.deletionRequested && (
        <>
          {" "}
          <Pill tone="warn">Запрошено удаление</Pill>
        </>
      )}
    </>
  );
}

function Roles({ user }: { user: Pick<AdminUserRow, "isPlayer" | "isCoach" | "isAdmin"> }) {
  return (
    <span className={styles.actions} style={{ gap: 4 }}>
      {user.isAdmin && <Pill tone="warn">Админ</Pill>}
      {user.isCoach && <Pill>Тренер</Pill>}
      {user.isPlayer && <Pill>Игрок</Pill>}
      {!user.isAdmin && !user.isCoach && !user.isPlayer && <span className={styles.muted}>—</span>}
    </span>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UserRoleFilter | "">("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [sort, setSort] = useState<UserSort>("created_desc");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useOpenParam();
  const q = useDebounced(search);

  useEffect(() => setOffset(0), [q, role, status, sort]);
  const { query, reload } = useAdminQuery(() => listAdminUsers({ q, role, status, sort, limit: PAGE_SIZE, offset }), [q, role, status, sort, offset]);

  return (
    <>
      <PageHead title="Пользователи" hint="Поиск по email, имени и ID. Блокировка отзывает все сессии пользователя сразу." />

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          type="search"
          placeholder="Email, имя или ID"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Поиск пользователей"
        />
        <select className={styles.select} value={role} onChange={(e) => setRole(e.target.value as UserRoleFilter | "")} aria-label="Роль">
          <option value="">Все роли</option>
          {(Object.keys(ROLE_LABELS) as UserRoleFilter[]).map((key) => (
            <option key={key} value={key}>
              {ROLE_LABELS[key]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "")} aria-label="Статус">
          <option value="">Любой статус</option>
          {(Object.keys(STATUS_LABELS) as UserStatus[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABELS[key]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value as UserSort)} aria-label="Сортировка">
          {(Object.keys(SORT_LABELS) as UserSort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
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
              <div className={styles.empty}>Никого не найдено. Измените запрос или фильтры.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Статус</th>
                    <th>Регистрация</th>
                    <th>Активность</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((user) => (
                    <tr
                      key={user.id}
                      className={styles.rowClickable}
                      tabIndex={0}
                      onClick={() => setOpenId(user.id)}
                      onKeyDown={(event) => event.key === "Enter" && setOpenId(user.id)}
                    >
                      <td>
                        <strong>{fullName(user) || "—"}</strong>
                        <div className={styles.muted}>{user.email ?? "без email"}</div>
                      </td>
                      <td>
                        <Roles user={user} />
                      </td>
                      <td>
                        <StatusPill user={user} />
                      </td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>{formatDateTime(user.lastActiveAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
        </>
      )}

      {openId && <UserDrawer userId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function UserDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { query, reload } = useAdminQuery(() => getAdminUser(userId), [userId]);
  const [dialog, setDialog] = useState<"block" | "unblock" | null>(null);
  const [days, setDays] = useState<number | null>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<AdminUserCard>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={styles.drawer} aria-label="Карточка пользователя">
        <div className={styles.drawerHead}>
          <h2 className={styles.cardTitle} style={{ margin: 0 }}>
            Карточка пользователя
          </h2>
          <button type="button" className={styles.button} onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

        {query.status === "loading" && <p className={styles.pageHint}>Загрузка…</p>}
        {query.status === "error" && <ErrorBox message={query.message} onRetry={reload} />}
        {query.status === "ready" && (
          <Card
            card={query.data}
            onBlock={() => {
              setError(null);
              setDialog("block");
            }}
            onUnblock={() => {
              setError(null);
              setDialog("unblock");
            }}
          />
        )}

        {dialog === "block" && query.status === "ready" && (
          <ReasonDialog
            title="Заблокировать пользователя"
            description={`${fullName(query.data)} потеряет доступ сразу: все его сессии будут завершены.`}
            confirmLabel="Заблокировать"
            danger
            busy={busy}
            error={error}
            extra={
              <label className={styles.field}>
                <span>Срок</span>
                <select className={styles.select} value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}>
                  {BLOCK_DURATIONS.map((d) => (
                    <option key={d.label} value={d.days ?? ""}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            }
            onConfirm={(reason) => void run(() => banAdminUser(userId, reason, days))}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "unblock" && (
          <ReasonDialog
            title="Снять блокировку"
            confirmLabel="Снять блокировку"
            busy={busy}
            error={error}
            onConfirm={(reason) => void run(() => unbanAdminUser(userId, reason))}
            onClose={() => setDialog(null)}
          />
        )}
      </aside>
    </div>
  );
}

function Card({ card, onBlock, onUnblock }: { card: AdminUserCard; onBlock: () => void; onUnblock: () => void }) {
  return (
    <>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{fullName(card) || "Без имени"}</h3>
        <dl className={styles.kv}>
          <dt>ID</dt>
          <dd className={styles.mono}>{card.id}</dd>
          <dt>Email</dt>
          <dd>
            {card.email ?? "—"} {card.email && <Pill tone={card.emailVerified ? "ok" : "warn"}>{card.emailVerified ? "подтверждён" : "не подтверждён"}</Pill>}
          </dd>
          <dt>Роль</dt>
          <dd>
            <Roles user={card} />
          </dd>
          <dt>Статус</dt>
          <dd>
            <StatusPill user={card} />
          </dd>
          <dt>Регистрация</dt>
          <dd>{formatDateTime(card.createdAt)}</dd>
          <dt>Последняя активность</dt>
          <dd>{formatDateTime(card.lastActiveAt)}</dd>
          <dt>Последний вход</dt>
          <dd>{formatDateTime(card.lastLoginAt)}</dd>
          <dt>Создано тренировок</dt>
          <dd>{card.trainingsCreated}</dd>
          <dt>Команд</dt>
          <dd>{card.teamsCount}</dd>
          <dt>Объявлений</dt>
          <dd>{card.listingsCount}</dd>
          <dt>Файлов</dt>
          <dd>{card.filesCount}</dd>
        </dl>
        {card.status === "banned" && (
          <p className={styles.error} style={{ marginTop: 12, marginBottom: 0 }}>
            Заблокирован {card.bannedUntil ? `до ${formatDateTime(card.bannedUntil)}` : "бессрочно"}. Причина: {card.banReason ?? "—"}
          </p>
        )}
      </section>

      <div className={styles.actions}>
        {card.status === "banned" ? (
          <button type="button" className={styles.buttonPrimary} onClick={onUnblock}>
            Снять блокировку
          </button>
        ) : card.status === "deleted" ? (
          <span className={styles.muted}>Аккаунт удалён — действий нет.</span>
        ) : card.isAdmin ? (
          <span className={styles.muted}>Администратора нельзя заблокировать в панели: уберите его адрес из ADMIN_EMAILS на сервере.</span>
        ) : (
          <button type="button" className={styles.buttonDanger} onClick={onBlock}>
            Заблокировать
          </button>
        )}
      </div>

      <section>
        <h3 className={styles.cardTitle}>История блокировок</h3>
        {card.bans.length === 0 ? (
          <p className={styles.muted}>Блокировок не было.</p>
        ) : (
          <ul className={styles.timeline}>
            {card.bans.map((ban) => (
              <li key={ban.id} className={styles.timelineItem}>
                <strong>{ban.reason}</strong>
                <span className={styles.timelineMeta}>
                  {formatDateTime(ban.bannedAt)} · {ban.expiresAt ? `до ${formatDate(ban.expiresAt)}` : "бессрочно"} · {ban.admin ?? "—"}
                </span>
                {ban.liftedAt && (
                  <span className={styles.timelineMeta}>
                    {ban.liftKind === "expired" ? "Истекла" : `Снята: ${ban.liftedBy ?? "—"} — ${ban.liftReason ?? ""}`} · {formatDateTime(ban.liftedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={styles.cardTitle}>История мер модерации</h3>
        {card.history.length === 0 ? (
          <p className={styles.muted}>Мер модерации не применялось.</p>
        ) : (
          <ul className={styles.timeline}>
            {card.history.map((entry) => (
              <li key={entry.id} className={styles.timelineItem}>
                <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
                {entry.result !== "success" && <> <Pill tone="bad">{entry.result === "denied" ? "отказано" : "ошибка"}</Pill></>}
                {entry.reason && <div>{entry.reason}</div>}
                <span className={styles.timelineMeta}>
                  {formatDateTime(entry.createdAt)} · {entry.admin ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export const ACTION_LABELS: Record<string, string> = { ban: "Блокировка", unban: "Снятие блокировки" };
