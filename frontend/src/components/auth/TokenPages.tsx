import { useEffect, useState, type FormEvent } from "react";
import {
  confirmEmailChange,
  forgotPassword,
  inspectVerification,
  resendVerification,
  resetPassword,
  verifyEmail,
  verifyEmailWithNewPassword,
  type VerificationInfo,
} from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import { loginUrl, navigate, safeNext, useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { AuthLayout } from "./AuthLayout";
import { Notice, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton, TextField } from "./fields";
import { looksLikeEmail, toFormError, type FormError } from "./authForm";
import styles from "./auth.module.css";

function readToken(search: string): string {
  return new URLSearchParams(search).get("token") ?? "";
}

/** One request per token for the lifetime of the page. React's StrictMode (dev)
 * runs effects twice, and a one-time link must not be spent by a duplicate call. */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let promise = inflight.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = run();
    inflight.set(key, promise);
  }
  return promise;
}

type Outcome<T> = { status: "working" } | { status: "ok"; value: T } | { status: "failed"; error: FormError };

function useTokenAction<T>(token: string, action: string, run: (token: string) => Promise<T>): Outcome<T> {
  const [outcome, setOutcome] = useState<Outcome<T>>(token ? { status: "working" } : { status: "failed", error: noToken() });
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    once(`${action}:${token}`, () => run(token))
      .then((value) => !cancelled && setOutcome({ status: "ok", value: value as T }))
      .catch((error: unknown) => !cancelled && setOutcome({ status: "failed", error: toFormError(error) }));
    return () => {
      cancelled = true;
    };
    // `run` is a stable module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, action]);
  return outcome;
}

function noToken(): FormError {
  return { message: "В ссылке нет кода подтверждения. Откройте её из письма целиком.", field: null, code: "invalid_token", retryAfter: null };
}

// --- email verification -------------------------------------------------------------

function ResendBox({ initialEmail = "", next = null }: { initialEmail?: string; next?: string | null }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Введите email полностью, например name@example.com.");
      return;
    }
    setError(null);
    setState("sending");
    try {
      await resendVerification(email.trim(), next);
      setState("sent");
    } catch (err) {
      setError(toFormError(err).message);
      setState("idle");
    }
  };

  if (state === "sent") {
    return <Notice kind="success">Если этот адрес ожидает подтверждения, мы отправили новое письмо. Проверьте почту.</Notice>;
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label="Email, указанный при регистрации"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={error}
        disabled={state === "sending"}
      />
      <SubmitButton loading={state === "sending"} loadingText="Отправляем…">
        Прислать новую ссылку
      </SubmitButton>
    </form>
  );
}

type VerifyMode = "confirm" | "set-password";

/** Opened from the confirmation email. Confirming an address also asks for a
 * password, so that a link which reached the wrong person (someone typed THEIR
 * address into a sign-up form with a password of their own) can't switch that
 * stranger's password on: the owner either enters the password they chose
 * when registering, or sets a new one - which replaces the stranger's. */
export function VerifyEmailPage() {
  const { search } = useLocation();
  const token = readToken(search);
  const next = safeNext(new URLSearchParams(search).get("next"));
  const { state } = useAuth();

  const [info, setInfo] = useState<VerificationInfo | null | "error">(token ? null : { valid: false, email: null, firstName: null });
  const [mode, setMode] = useState<VerifyMode>("confirm");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    inspectVerification(token)
      .then((result) => !cancelled && setInfo(result))
      .catch(() => !cancelled && setInfo("error"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (mode === "set-password") {
      if ([...password].length < PASSWORD_MIN_LENGTH) {
        setLocalError(`Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`);
        return;
      }
      if (password !== confirm) {
        setLocalError("Пароли не совпадают.");
        return;
      }
    } else if (!password) {
      setLocalError("Введите пароль.");
      return;
    }
    setSubmitting(true);
    try {
      const result = mode === "set-password" ? await verifyEmailWithNewPassword(token, password, confirm) : await verifyEmail(token, password);
      setDone(result.email);
    } catch (err) {
      const failure = toFormError(err);
      if (failure.code === "invalid_token") setInfo({ valid: false, email: null, firstName: null });
      else setError(failure);
      setSubmitting(false);
    }
  };

  if (info === null) {
    return (
      <AuthLayout title="Подтверждаем email…">
        <p className={styles.lead}>Одну секунду, проверяем ссылку.</p>
        <div className={styles.statusIcon}>
          <span className={styles.spinner} style={{ width: 26, height: 26 }} aria-hidden="true" />
        </div>
      </AuthLayout>
    );
  }

  if (done !== undefined) {
    const signedIn = state.status === "ready";
    return (
      <AuthLayout
        title="Email подтверждён"
        lead={done ? <>Адрес <span className={styles.address}>{done}</span> подтверждён — аккаунт готов к работе.</> : "Аккаунт готов к работе."}
      >
        <div className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
          <Icon name="check-circle" size={32} />
        </div>
        <div className={styles.stack}>
          {signedIn ? (
            <Link to={next ?? "/"} className={styles.primary}>
              Перейти в приложение
            </Link>
          ) : (
            <Link to={`/login?verified=1${next ? `&next=${encodeURIComponent(next)}` : ""}`} className={styles.primary}>
              Войти
            </Link>
          )}
        </div>
      </AuthLayout>
    );
  }

  if (info === "error" || !info.valid) {
    return (
      <AuthLayout title="Ссылка не сработала" lead={info === "error" ? "Не удалось проверить ссылку. Попробуйте ещё раз." : "Ссылка недействительна или устарела. Запросите новую."}>
        <div className={`${styles.statusIcon} ${styles.statusIconDanger}`}>
          <Icon name="alert-triangle" size={30} />
        </div>
        <p className={styles.lead} style={{ margin: 0 }}>
          Возможно, ссылка уже использована или устарела. Запросите новую — старая перестанет работать.
        </p>
        <ResendBox next={next} />
        <p className={styles.footerLine}>
          Уже подтвердили?{" "}
          <Link to={loginUrl(next)} className={styles.link}>
            Войти
          </Link>
        </p>
      </AuthLayout>
    );
  }

  const passwordError = localError ?? (error?.field === "password" ? error.message : null);
  const setting = mode === "set-password";
  return (
    <AuthLayout
      title={setting ? "Новый пароль" : "Подтвердите email"}
      lead={
        setting ? (
          <>
            Вы подтверждаете адрес <span className={styles.address}>{info.email}</span> и задаёте для него новый пароль. Пароль,
            указанный при регистрации, перестанет действовать.
          </>
        ) : (
          <>
            Чтобы подтвердить адрес <span className={styles.address}>{info.email}</span>, введите пароль, который вы указали при
            регистрации. Так мы убеждаемся, что аккаунт активирует тот, кто его создавал.
          </>
        )
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {error && error.field !== "password" && <Notice kind="danger">{error.message}</Notice>}
        {error?.code === "password_mismatch" && !setting && (
          <Notice kind="info">
            Если вы не регистрировались или не помните пароль —{" "}
            <button type="button" className={styles.linkButton} onClick={() => { setMode("set-password"); setPassword(""); setError(null); }}>
              задайте новый пароль
            </button>
            . Доступ к этому письму подтверждает, что адрес ваш.
          </Notice>
        )}
        <PasswordField
          label={setting ? "Новый пароль" : "Пароль"}
          name={setting ? "new-password" : "current-password"}
          autoComplete={setting ? "new-password" : "current-password"}
          autoFocus
          showMeter={setting}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setLocalError(null);
          }}
          error={passwordError}
          hint={setting ? `Минимум ${PASSWORD_MIN_LENGTH} символов.` : undefined}
          disabled={submitting}
        />
        {setting && (
          <PasswordField
            label="Повторите пароль"
            name="new-password-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
          />
        )}
        <SubmitButton loading={submitting} loadingText="Подтверждаем…">
          {setting ? "Подтвердить и сохранить пароль" : "Подтвердить email"}
        </SubmitButton>
        {!setting ? (
          <button type="button" className={styles.linkButton} style={{ alignSelf: "center" }} onClick={() => { setMode("set-password"); setPassword(""); setError(null); }}>
            Я не регистрировался(-ась) или забыл(-а) пароль
          </button>
        ) : (
          <button type="button" className={styles.linkButton} style={{ alignSelf: "center" }} onClick={() => { setMode("confirm"); setPassword(""); setConfirm(""); setLocalError(null); }}>
            Назад: ввести прежний пароль
          </button>
        )}
      </form>
    </AuthLayout>
  );
}

export function ConfirmEmailChangePage() {
  const { search } = useLocation();
  const token = readToken(search);
  const { state, refreshUser } = useAuth();
  const outcome = useTokenAction(token, "confirm-email-change", async (t) => confirmEmailChange(t));

  useEffect(() => {
    if (outcome.status === "ok" && state.status === "ready") void refreshUser();
    // Only once the change is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome.status]);

  if (outcome.status === "working") {
    return (
      <AuthLayout title="Подтверждаем новый email…">
        <div className={styles.statusIcon}>
          <span className={styles.spinner} style={{ width: 26, height: 26 }} aria-hidden="true" />
        </div>
      </AuthLayout>
    );
  }
  if (outcome.status === "ok") {
    return (
      <AuthLayout title="Email изменён" lead={outcome.value.email ? <>Теперь вы входите с адресом <span className={styles.address}>{outcome.value.email}</span>.</> : undefined}>
        <div className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
          <Icon name="check-circle" size={32} />
        </div>
        <Link to={state.status === "ready" ? "/" : "/login"} className={styles.primary}>
          {state.status === "ready" ? "Перейти в приложение" : "Войти"}
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Ссылка не сработала" lead={outcome.error.message}>
      <div className={`${styles.statusIcon} ${styles.statusIconDanger}`}>
        <Icon name="alert-triangle" size={30} />
      </div>
      <p className={styles.lead} style={{ margin: 0 }}>
        Запросите смену email ещё раз в настройках аккаунта: войдите и откройте «Аккаунт и безопасность».
      </p>
      <Link to={state.status === "ready" ? "/" : "/login"} className={styles.primary}>
        {state.status === "ready" ? "В приложение" : "Войти"}
      </Link>
    </AuthLayout>
  );
}

// --- password recovery ------------------------------------------------------------------

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Введите email полностью, например name@example.com.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      setSentMessage(await forgotPassword(email.trim()));
    } catch (err) {
      setError(toFormError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sentMessage) {
    return (
      <AuthLayout title="Письмо отправлено">
        <div className={styles.statusIcon}>
          <Icon name="mail" size={30} />
        </div>
        {/* The server's wording is intentionally the same for every address. */}
        <p className={styles.lead} style={{ margin: 0 }}>
          {sentMessage} Ссылка действует 30 минут. Проверьте папку «Спам», если письма нет.
        </p>
        <div className={styles.stack}>
          <Link to="/login" className={styles.primary}>
            Вернуться ко входу
          </Link>
          <button type="button" className={styles.secondary} onClick={() => setSentMessage(null)}>
            Ввести другой адрес
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Забыли пароль?" lead="Укажите email аккаунта — пришлём ссылку для создания нового пароля.">
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
          disabled={submitting}
          placeholder="name@example.com"
        />
        <SubmitButton loading={submitting} loadingText="Отправляем…">
          Прислать ссылку
        </SubmitButton>
      </form>
      <p className={styles.footerLine}>
        Вспомнили пароль?{" "}
        <Link to="/login" className={styles.link}>
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { search } = useLocation();
  const token = readToken(search);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [localError, setLocalError] = useState<{ field: "password" | "confirm"; message: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if ([...password].length < PASSWORD_MIN_LENGTH) {
      setLocalError({ field: "password", message: `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.` });
      return;
    }
    if (password !== confirm) {
      setLocalError({ field: "confirm", message: "Пароли не совпадают." });
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password, confirm);
      navigate("/password-changed", { replace: true });
    } catch (err) {
      setError(toFormError(err));
      setSubmitting(false);
    }
  };

  if (!token || error?.code === "invalid_token") {
    return (
      <AuthLayout title="Ссылка не работает" lead={error?.message ?? noToken().message}>
        <div className={`${styles.statusIcon} ${styles.statusIconDanger}`}>
          <Icon name="alert-triangle" size={30} />
        </div>
        <p className={styles.lead} style={{ margin: 0 }}>
          Ссылка для восстановления действует 30 минут и открывается один раз. Запросите новую.
        </p>
        <Link to="/forgot-password" className={styles.primary}>
          Запросить новую ссылку
        </Link>
      </AuthLayout>
    );
  }

  const passwordError = localError?.field === "password" ? localError.message : error?.field === "password" ? error.message : null;
  const confirmError = localError?.field === "confirm" ? localError.message : error?.field === "password_confirm" ? error?.message : null;

  return (
    <AuthLayout title="Новый пароль" lead="Придумайте пароль для входа. После смены мы завершим все активные сессии.">
      <form className={styles.form} onSubmit={submit} noValidate>
        {error && !error.field && <Notice kind="danger">{error.message}</Notice>}
        <PasswordField
          label="Новый пароль"
          name="new-password"
          autoComplete="new-password"
          autoFocus
          showMeter
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          hint={`Минимум ${PASSWORD_MIN_LENGTH} символов. Подойдёт фраза из нескольких слов.`}
          disabled={submitting}
        />
        <PasswordField
          label="Повторите пароль"
          name="new-password-confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirmError}
          disabled={submitting}
        />
        <SubmitButton loading={submitting} loadingText="Сохраняем…">
          Сохранить пароль
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}

export function PasswordChangedPage() {
  return (
    <AuthLayout title="Пароль изменён">
      <div className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
        <Icon name="check-circle" size={32} />
      </div>
      <p className={styles.lead} style={{ margin: 0 }}>
        Готово: новый пароль сохранён, а на всех устройствах мы вышли из аккаунта. Войдите с новым паролем. Мы также
        отправили вам письмо-уведомление.
      </p>
      <Link to="/login?reset=1" className={styles.primary}>
        Войти
      </Link>
    </AuthLayout>
  );
}
