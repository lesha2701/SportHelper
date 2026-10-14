import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  cancelAccountDeletion,
  changeEmail,
  changePassword,
  disableMfa,
  enableMfa,
  getMfaStatus,
  listSessions,
  logoutAll,
  requestAccountDeletion,
  revokeSession,
  setupMfa,
  startTelegramLink,
  unlinkTelegram,
  verifyMfa,
  type MfaStatus,
  type Session,
} from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import { Icon } from "../shared/Icon";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Notice, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton, TextField } from "../auth/fields";
import { looksLikeEmail, toFormError } from "../auth/authForm";
import profileStyles from "./profile.module.css";
import styles from "./accountSecurity.module.css";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className={profileStyles.card}>
      <h2 className={profileStyles.title}>{title}</h2>
      {hint && <p className={profileStyles.subtitle}>{hint}</p>}
      {children}
    </section>
  );
}

// --- email -------------------------------------------------------------------------------

function EmailSection() {
  const { state } = useAuth();
  const user = state.status === "ready" ? state.user : null;
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!user) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!looksLikeEmail(newEmail)) {
      setError({ field: "new_email", message: "Введите email полностью, например name@example.com." });
      return;
    }
    if (!password) {
      setError({ field: "password", message: "Введите пароль для подтверждения." });
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await changeEmail(newEmail.trim(), password);
      setSentTo(newEmail.trim());
      setEditing(false);
      setPassword("");
    } catch (err) {
      const failure = toFormError(err);
      setError({ field: failure.field, message: failure.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Email">
      <div className={profileStyles.row}>
        <span className={profileStyles.rowLabel}>Адрес</span>
        <span className={profileStyles.rowValue}>
          {user.email ?? "—"}
          {user.emailVerified && <span className={styles.badge}>подтверждён</span>}
        </span>
      </div>

      {sentTo && (
        <Notice kind="success">
          Мы отправили письмо на <strong>{sentTo}</strong>. Email изменится после подтверждения; на старый адрес ушло
          предупреждение.
        </Notice>
      )}

      {editing ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextField
            label="Новый email"
            type="email"
            name="new-email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            error={error?.field === "new_email" ? error.message : null}
            disabled={busy}
          />
          <PasswordField
            label="Текущий пароль"
            name="current-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error?.field === "password" ? error.message : null}
            hint="Для смены email нужно подтвердить, что это вы."
            disabled={busy}
          />
          {error && !["new_email", "password"].includes(error.field ?? "") && <Notice kind="danger">{error.message}</Notice>}
          <SubmitButton loading={busy} loadingText="Отправляем…">
            Отправить подтверждение
          </SubmitButton>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setEditing(false)} disabled={busy}>
            Отмена
          </button>
        </form>
      ) : (
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => { setEditing(true); setSentTo(null); }}>
          <Icon name="edit" size={16} />
          Изменить email
        </button>
      )}
    </Section>
  );
}

// --- password ------------------------------------------------------------------------------

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return setError({ field: "password", message: "Введите текущий пароль." });
    if ([...next].length < PASSWORD_MIN_LENGTH)
      return setError({ field: "new_password", message: `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.` });
    if (next !== confirm) return setError({ field: "new_password_confirm", message: "Пароли не совпадают." });
    setError(null);
    setBusy(true);
    try {
      setDone(await changePassword(current, next, confirm));
      setEditing(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      onChanged();
    } catch (err) {
      const failure = toFormError(err);
      setError({ field: failure.code === "invalid_password" ? "password" : failure.field, message: failure.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Пароль" hint="После смены пароля вы останетесь в аккаунте на этом устройстве, а на остальных выйдете.">
      {done && <Notice kind="success">{done}</Notice>}
      {editing ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <PasswordField
            label="Текущий пароль"
            name="current-password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={error?.field === "password" ? error.message : null}
            disabled={busy}
          />
          <PasswordField
            label="Новый пароль"
            name="new-password"
            autoComplete="new-password"
            showMeter
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={error?.field === "new_password" ? error.message : null}
            hint={`Минимум ${PASSWORD_MIN_LENGTH} символов.`}
            disabled={busy}
          />
          <PasswordField
            label="Повторите новый пароль"
            name="new-password-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={error?.field === "new_password_confirm" ? error.message : null}
            disabled={busy}
          />
          {error && !["password", "new_password", "new_password_confirm"].includes(error.field ?? "") && (
            <Notice kind="danger">{error.message}</Notice>
          )}
          <SubmitButton loading={busy} loadingText="Сохраняем…">
            Сменить пароль
          </SubmitButton>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setEditing(false)} disabled={busy}>
            Отмена
          </button>
        </form>
      ) : (
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => { setEditing(true); setDone(null); }}>
          <Icon name="lock" size={16} />
          Сменить пароль
        </button>
      )}
    </Section>
  );
}

// --- sessions ---------------------------------------------------------------------------------

function SessionsSection({ reloadKey }: { reloadKey: number }) {
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(() => {
    listSessions()
      .then((items) => {
        setSessions(items);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(toFormError(err).message));
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const end = async (session: Session) => {
    setBusyId(session.id);
    try {
      await revokeSession(session.id);
      if (session.current) await logout();
      else load();
    } catch {
      /* the API layer already toasted the reason */
    } finally {
      setBusyId(null);
    }
  };

  const endAll = async () => {
    setBusyAll(true);
    try {
      await logoutAll();
      await logout();
    } catch {
      setBusyAll(false);
      setConfirmAll(false);
    }
  };

  return (
    <Section title="Устройства и сессии" hint="Здесь все места, где выполнен вход. Незнакомое устройство можно завершить.">
      {loadError && <Notice kind="danger">{loadError}</Notice>}
      {!sessions && !loadError && <p className={profileStyles.subtitle}>Загрузка…</p>}
      {sessions && (
        <ul className={styles.sessionList}>
          {sessions.map((session) => (
            <li key={session.id} className={styles.session}>
              <span className={styles.sessionIcon}>
                <Icon name="monitor" size={18} />
              </span>
              <div className={styles.sessionText}>
                <span className={styles.sessionDevice}>
                  {session.device}
                  {session.current && <span className={styles.badge}>это устройство</span>}
                </span>
                <span className={styles.sessionMeta}>
                  {session.ipAddress ? `${session.ipAddress} · ` : ""}
                  активность {formatWhen(session.lastSeenAt)}
                </span>
              </div>
              {!session.current && (
                <button type="button" className={styles.smallButton} onClick={() => void end(session)} disabled={busyId === session.id}>
                  {busyId === session.id ? "…" : "Завершить"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={profileStyles.buttonSecondary} onClick={() => setConfirmAll(true)}>
        <Icon name="log-out" size={16} />
        Выйти на всех устройствах
      </button>
      {confirmAll && (
        <ConfirmModal
          title="Выйти везде?"
          description="Вы выйдете из аккаунта на всех устройствах, включая это. Чтобы продолжить, нужно будет войти заново."
          confirmLabel="Выйти везде"
          danger
          busy={busyAll}
          onConfirm={() => void endAll()}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </Section>
  );
}

// --- telegram -----------------------------------------------------------------------------------

function TelegramSection() {
  const { state, refreshUser } = useAuth();
  const linked = state.status === "ready" && state.user.telegramLinked;
  const [busy, setBusy] = useState(false);
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const link = await startTelegramLink();
      setBotUrl(link.botUrl);
    } catch (err) {
      setError(toFormError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await unlinkTelegram();
      await refreshUser();
      setBotUrl(null);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Уведомления в Telegram"
      hint="Необязательно. Сайт работает без Telegram, а все уведомления всегда есть в колокольчике. Подключите бота, если хотите получать их ещё и в мессенджер."
    >
      {error && <Notice kind="danger">{error}</Notice>}
      {linked ? (
        <>
          <Notice kind="success">Telegram подключён: уведомления приходят и в чат с ботом.</Notice>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void unlink()} disabled={busy}>
            Отвязать Telegram
          </button>
        </>
      ) : botUrl ? (
        <>
          <Notice kind="info">Откройте бота и подтвердите подключение. Ссылка действует 30 минут.</Notice>
          <a className={profileStyles.buttonPrimary} href={botUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <Icon name="send" size={16} />
            Открыть бота
          </a>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => void refreshUser()}>
            Я подтвердил — обновить
          </button>
        </>
      ) : (
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => void start()} disabled={busy}>
          <Icon name="send" size={16} />
          Подключить Telegram
        </button>
      )}
    </Section>
  );
}

// --- two-factor (administrators) -----------------------------------------------------------------------

function MfaSection() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMfaStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  if (!status?.isAdmin) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toFormError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Двухфакторная защита"
      hint="Для администраторов обязательна: без неё доступ к финансовым операциям закрыт. Нужно приложение-аутентификатор (Google Authenticator, Яндекс Ключ и т. п.)."
    >
      {error && <Notice kind="danger">{error}</Notice>}

      {recovery && (
        <Notice kind="info">
          <strong>Сохраните резервные коды</strong> — каждый подходит один раз, если не будет телефона. Больше мы их не покажем.
          <pre className={styles.codes}>{recovery.join("\n")}</pre>
          <button type="button" className={styles.linkButton} onClick={() => setRecovery(null)}>
            Я сохранил коды
          </button>
        </Notice>
      )}

      {status.enabled ? (
        <>
          <Notice kind={status.sessionVerified ? "success" : "info"}>
            {status.sessionVerified ? "Включена. Код для этой сессии подтверждён." : "Включена. Для операций нужен код в этой сессии."}
          </Notice>
          {!status.sessionVerified && (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await verifyMfa(code);
                  setCode("");
                  load();
                });
              }}
            >
              <TextField label="Код из приложения" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
              <SubmitButton loading={busy} loadingText="Проверяем…">
                Подтвердить код
              </SubmitButton>
            </form>
          )}
          {disabling ? (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await disableMfa(password, code);
                  setDisabling(false);
                  setPassword("");
                  setCode("");
                  load();
                });
              }}
            >
              <PasswordField label="Пароль" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              <TextField label="Код из приложения" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
              <SubmitButton loading={busy} loadingText="Отключаем…">
                Отключить защиту
              </SubmitButton>
            </form>
          ) : (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDisabling(true)}>
              Отключить
            </button>
          )}
        </>
      ) : setup ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setRecovery(await enableMfa(code));
              setSetup(null);
              setCode("");
              load();
            });
          }}
        >
          <p className={profileStyles.subtitle}>
            Добавьте в приложение ключ вручную: <code className={styles.secret}>{setup.secret}</code>
            <br />
            (или откройте <a href={setup.otpauthUri}>ссылку настройки</a> на телефоне).
          </p>
          <TextField label="Код из приложения" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
          <SubmitButton loading={busy} loadingText="Проверяем…">
            Включить защиту
          </SubmitButton>
        </form>
      ) : (
        <button type="button" className={profileStyles.buttonPrimary} disabled={busy} onClick={() => void run(async () => setSetup(await setupMfa()))}>
          <Icon name="shield" size={16} />
          Настроить
        </button>
      )}
    </Section>
  );
}

// --- deleting the account ---------------------------------------------------------------------------------

function DeleteSection() {
  const { state, refreshUser } = useAuth();
  const pending = state.status === "ready" ? state.user.deletionRequestedAt : null;
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMessage(await requestAccountDeletion(password));
      setOpen(false);
      setPassword("");
      await refreshUser();
    } catch (err) {
      setError(toFormError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelAccountDeletion();
      setMessage(null);
      await refreshUser();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Удаление аккаунта"
      hint="Личные данные будут обезличены через 14 дней. Тренировки, записи и другие общие данные не удаляются каскадом, а записи, которые нужно хранить по закону (в том числе финансовая история), сохраняются без привязки к вам."
    >
      {pending && (
        <Notice kind="danger">
          Удаление запрошено {formatWhen(pending)}. До окончания 14 дней его можно отменить.
          <div className={styles.noticeAction}>
            <button type="button" className={styles.linkButton} onClick={() => void cancel()} disabled={busy}>
              Отменить удаление
            </button>
          </div>
        </Notice>
      )}
      {message && !pending && <Notice kind="info">{message}</Notice>}
      {!pending &&
        (open ? (
          <form className={styles.form} onSubmit={submit}>
            <PasswordField
              label="Пароль для подтверждения"
              name="current-password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
              disabled={busy}
            />
            <button type="submit" className={styles.dangerButton} disabled={busy || !password}>
              {busy ? "Отправляем…" : "Удалить аккаунт через 14 дней"}
            </button>
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
          </form>
        ) : (
          <button type="button" className={styles.dangerOutline} onClick={() => setOpen(true)}>
            <Icon name="trash" size={16} />
            Запросить удаление
          </button>
        ))}
    </Section>
  );
}

// --- the screen section --------------------------------------------------------------------------------------

export function AccountSecurity() {
  const { logout } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <h2 className={styles.groupTitle}>Аккаунт и безопасность</h2>
      <EmailSection />
      <PasswordSection onChanged={() => setReloadKey((k) => k + 1)} />
      <SessionsSection reloadKey={reloadKey} />
      <TelegramSection />
      <MfaSection />
      <DeleteSection />
      <button type="button" className={profileStyles.buttonSecondary} onClick={() => void logout()}>
        <Icon name="log-out" size={16} />
        Выйти из аккаунта
      </button>
    </>
  );
}
