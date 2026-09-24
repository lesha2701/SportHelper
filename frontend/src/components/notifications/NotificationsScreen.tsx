// frontend/src/components/notifications/NotificationsScreen.tsx
import { useEffect, useState } from "react";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../../api/notifications";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon, type IconName } from "../shared/Icon";
import type { NotificationCategory, NotificationItem } from "../../types/notification";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./notifications.module.css";

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  training_reminder: "calendar",
  new_training: "calendar",
  task_deadline: "clipboard",
  new_task: "clipboard",
  new_match: "trophy",
  booking_requested: "inbox",
  booking_decided: "inbox",
};

function formatSendAt(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Full notification feed — reachable from the TopBar bell (desktop) and
 * from "Уведомления" in the Profile action list (all breakpoints). Clicking
 * an item marks it read and hands it to `onOpen`, which decides where to
 * navigate based on its category/entity (see Workspace.tsx). */
export function NotificationsScreen({
  token,
  onBack,
  onOpen,
}: {
  token: string;
  onBack: () => void;
  onOpen: (notification: NotificationItem) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: NotificationItem[] }
  >({ status: "loading" });
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    listNotifications(token)
      .then((items) => setState({ status: "ready", items }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить уведомления" }),
      );
  }, [token]);

  const handleOpen = (item: NotificationItem) => {
    if (!item.readAt) {
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", items: prev.items.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)) }
          : prev,
      );
      void markNotificationRead(token, item.id).catch(() => {
        // Best-effort — navigation shouldn't block on this, and a failed
        // read-mark just means the item still shows as unread next visit.
      });
    }
    onOpen(item);
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(token);
      setState((prev) =>
        prev.status === "ready" ? { status: "ready", items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) } : prev,
      );
    } catch {
      // Non-critical — the user can retry, nothing else depends on this succeeding immediately.
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = state.status === "ready" ? state.items.filter((n) => !n.readAt).length : 0;

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={styles.headerActions}>
        <h1 className={profileStyles.pageHeading}>Уведомления</h1>
        {unreadCount > 0 && (
          <button type="button" className={styles.markAllLink} onClick={() => void handleMarkAll()} disabled={markingAll}>
            Прочитать все
          </button>
        )}
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка уведомлений…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить уведомления" description={state.message} />}
      {state.status === "ready" && state.items.length === 0 && (
        <div className={profileStyles.card}>
          <p className={profileStyles.subtitle}>Пока нет уведомлений.</p>
        </div>
      )}

      {state.status === "ready" &&
        state.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.readAt
                ? `${profileStyles.card} ${styles.notificationCard}`
                : `${profileStyles.card} ${styles.notificationCard} ${styles.notificationCardUnread}`
            }
            onClick={() => handleOpen(item)}
          >
            <div className={styles.notificationTop}>
              <span className={styles.notificationIcon}>
                <Icon name={CATEGORY_ICON[item.category]} size={17} />
              </span>
              <div className={styles.notificationBody}>
                <div className={styles.notificationTitleRow}>
                  <span className={styles.notificationTitle}>{item.title}</span>
                  {!item.readAt && <span className={styles.unreadDot} aria-label="Непрочитано" />}
                </div>
                <p className={styles.notificationText}>{item.body}</p>
                <p className={styles.notificationTime}>{formatSendAt(item.sendAt)}</p>
              </div>
            </div>
          </button>
        ))}
    </div>
  );
}
