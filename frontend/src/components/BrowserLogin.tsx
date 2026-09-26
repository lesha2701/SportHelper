import { useCallback, useEffect, useState } from "react";
import { pollBrowserLogin, startBrowserLogin, type BrowserLoginStart } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { StateScreen } from "./StateScreen";
import styles from "./StateScreen.module.css";

const POLL_INTERVAL_MS = 2000;

/** Login for a plain browser tab (outside the Telegram Mini App): the user
 * confirms in the bot, and this screen polls until the token is confirmed. */
export function BrowserLogin() {
  const { signIn } = useAuth();
  const [session, setSession] = useState<BrowserLoginStart | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const start = useCallback(() => {
    setSession(null);
    setFailed(null);
    setExpired(false);
    startBrowserLogin()
      .then(setSession)
      .catch(() => setFailed("Не удалось начать вход. Проверьте соединение и попробуйте ещё раз."));
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (!session || expired) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      pollBrowserLogin(session.token)
        .then((poll) => {
          if (cancelled) return;
          if (poll.status === "ok") signIn(poll.result);
          else if (poll.status === "expired") setExpired(true);
        })
        .catch(() => {
          // transient network error — keep polling
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, expired, signIn]);

  if (failed) {
    return <StateScreen kind="error" title="Не удалось войти" description={failed} onRetry={start} />;
  }
  if (!session) {
    return <StateScreen kind="loading" title="Подготовка входа…" />;
  }
  if (expired) {
    return (
      <StateScreen kind="empty" title="Ссылка для входа устарела" description="Начните вход заново." onRetry={start} />
    );
  }

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>Вход в SportArena Global</h2>
      <p className={styles.description}>
        Откройте бота в Telegram и подтвердите вход — эта страница обновится автоматически.
      </p>
      <a className={styles.retryButton} style={{ textDecoration: "none" }} href={session.botUrl} target="_blank" rel="noopener noreferrer">
        Войти через Telegram
      </a>
    </div>
  );
}
