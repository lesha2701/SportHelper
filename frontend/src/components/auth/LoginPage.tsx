import { useState, type FormEvent } from "react";
import { login, resendVerification } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import { navigate, registerUrl, safeNext, useLocation } from "../../router";
import { Link } from "../Link";
import { AuthLayout } from "./AuthLayout";
import { Notice, PasswordField, SubmitButton, TextField } from "./fields";
import { looksLikeEmail, toFormError, type FormError } from "./authForm";
import styles from "./auth.module.css";

function isBookingIntent(next: string | null): boolean {
  return !!next && new URLSearchParams(next.split("?")[1] ?? "").has("book");
}

export function LoginPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const next = safeNext(params.get("next"));
  const { state, signIn } = useAuth();

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResend("idle");
    if (!looksLikeEmail(email)) {
      setEmailError("Введите email полностью, например name@example.com.");
      return;
    }
    setEmailError(null);
    if (!password) {
      setError({ message: "Введите пароль.", field: "password", code: null, retryAfter: null });
      return;
    }
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      signIn(result);
      navigate(next ?? "/", { replace: true });
    } catch (err) {
      setError(toFormError(err));
      setSubmitting(false);
    }
  };

  const sendAgain = async () => {
    setResend("sending");
    try {
      await resendVerification(email.trim());
      setResend("sent");
    } catch (err) {
      setError(toFormError(err));
      setResend("idle");
    }
  };

  const expired = state.status === "guest" && state.sessionExpired;
  const notVerified = error?.code === "email_not_verified";

  return (
    <AuthLayout title="Вход" lead="Рады видеть вас снова. Войдите, чтобы продолжить.">
      {expired && <Notice kind="info">Сессия закончилась, поэтому нужно войти снова.</Notice>}
      {params.get("verified") && <Notice kind="success">Email подтверждён. Теперь можно войти.</Notice>}
      {params.get("reset") && <Notice kind="success">Пароль изменён. Войдите с новым паролем.</Notice>}
      {isBookingIntent(next) && (
        <Notice kind="info">Войдите или создайте аккаунт, чтобы записаться на тренировку — мы вернём вас к выбранному объявлению.</Notice>
      )}

      <form className={styles.form} onSubmit={submit} noValidate>
        {error && !notVerified && error.field !== "password" && <Notice kind="danger">{error.message}</Notice>}
        {notVerified && (
          <Notice kind="danger">
            {error.message}
            <div className={styles.noticeAction}>
              {resend === "sent" ? (
                <strong>Письмо отправлено — проверьте почту.</strong>
              ) : (
                <button type="button" className={styles.linkButton} onClick={sendAgain} disabled={resend === "sending"}>
                  {resend === "sending" ? "Отправляем…" : "Отправить письмо ещё раз"}
                </button>
              )}
            </div>
          </Notice>
        )}

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus={!email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          disabled={submitting}
          placeholder="name@example.com"
        />
        <PasswordField
          label="Пароль"
          name="password"
          autoComplete="current-password"
          autoFocus={!!email}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error?.field === "password" ? error.message : null}
          disabled={submitting}
          labelAside={
            <Link to="/forgot-password" className={styles.link} style={{ fontSize: 13 }}>
              Забыли пароль?
            </Link>
          }
        />
        <SubmitButton loading={submitting} loadingText="Входим…">
          Войти
        </SubmitButton>
      </form>

      <p className={styles.footerLine}>
        Впервые у нас?{" "}
        <Link to={registerUrl(next)} className={styles.link}>
          Создать аккаунт
        </Link>
      </p>
      <p className={styles.footerLine} style={{ fontSize: 13 }}>
        Пользовались ботом в Telegram? Откройте бота и нажмите /start — он поможет перенести ваш аккаунт.
      </p>
    </AuthLayout>
  );
}
