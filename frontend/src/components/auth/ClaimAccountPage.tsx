import { useEffect, useState, type FormEvent } from "react";
import { claimAccount, inspectClaim } from "../../api/auth";
import { useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { AuthLayout } from "./AuthLayout";
import { CheckEmailScreen } from "./CheckEmailScreen";
import { Checkbox, Notice, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton, TextField } from "./fields";
import { looksLikeEmail, toFormError } from "./authForm";
import styles from "./auth.module.css";

type Inspect = { status: "checking" } | { status: "invalid" } | { status: "valid"; firstName: string | null };
type FieldErrors = Partial<Record<"email" | "password" | "passwordConfirm" | "acceptTerms", string>>;

/** Opened from the link the Telegram bot sends. It attaches an email and a
 * password to the user's EXISTING account (same data, same history). */
export function ClaimAccountPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [inspect, setInspect] = useState<Inspect>(token ? { status: "checking" } : { status: "invalid" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    inspectClaim(token)
      .then((result) => !cancelled && setInspect(result.valid ? { status: "valid", firstName: result.firstName } : { status: "invalid" }))
      .catch(() => !cancelled && setInspect({ status: "invalid" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const clearError = (field: keyof FieldErrors) => setErrors((current) => ({ ...current, [field]: undefined }));

  if (sentTo) return <CheckEmailScreen email={sentTo} onChangeEmail={undefined} />;

  if (inspect.status === "checking") {
    return (
      <AuthLayout title="Проверяем ссылку…">
        <div className={styles.statusIcon}>
          <span className={styles.spinner} style={{ width: 26, height: 26 }} aria-hidden="true" />
        </div>
      </AuthLayout>
    );
  }

  if (inspect.status === "invalid") {
    return (
      <AuthLayout title="Ссылка устарела" lead="Ссылка для переноса аккаунта действует 30 минут и открывается один раз.">
        <div className={`${styles.statusIcon} ${styles.statusIconDanger}`}>
          <Icon name="alert-triangle" size={30} />
        </div>
        <p className={styles.lead} style={{ margin: 0 }}>
          Откройте бота SportArenaGlobal в Telegram и нажмите /start — он пришлёт новую ссылку.
        </p>
        <Link to="/login" className={styles.secondary}>
          Ко входу
        </Link>
      </AuthLayout>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const found: FieldErrors = {};
    if (!looksLikeEmail(email)) found.email = "Введите email полностью, например name@example.com.";
    if ([...password].length < PASSWORD_MIN_LENGTH) found.password = `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`;
    if (password !== passwordConfirm) found.passwordConfirm = "Пароли не совпадают.";
    if (!acceptTerms) found.acceptTerms = "Нужно принять пользовательское соглашение и политику конфиденциальности.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const result = await claimAccount({ token, email: email.trim(), password, passwordConfirm, acceptTerms });
      setSentTo(result.email);
    } catch (err) {
      const failure = toFormError(err);
      if (failure.code === "invalid_token") setInspect({ status: "invalid" });
      else if (failure.field === "email") setErrors({ email: failure.message });
      else if (failure.field === "password") setErrors({ password: failure.message });
      else if (failure.field === "password_confirm") setErrors({ passwordConfirm: failure.message });
      else if (failure.field === "accept_terms") setErrors({ acceptTerms: failure.message });
      else setFormError(failure.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={inspect.firstName ? `${inspect.firstName}, добро пожаловать` : "Перенос аккаунта"}
      lead="Ваш аккаунт со всеми тренировками, командами и записями остаётся прежним. Укажите email и пароль — дальше вход будет как на обычном сайте."
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        {formError && <Notice kind="danger">{formError}</Notice>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
          }}
          error={errors.email}
          hint="Отправим письмо для подтверждения. Адрес станет вашим логином."
          disabled={submitting}
          placeholder="name@example.com"
        />
        <PasswordField
          label="Пароль"
          name="new-password"
          autoComplete="new-password"
          showMeter
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clearError("password");
          }}
          error={errors.password}
          hint={`Минимум ${PASSWORD_MIN_LENGTH} символов. Подойдёт фраза из нескольких слов.`}
          disabled={submitting}
        />
        <PasswordField
          label="Повторите пароль"
          name="new-password-confirm"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => {
            setPasswordConfirm(e.target.value);
            clearError("passwordConfirm");
          }}
          error={errors.passwordConfirm}
          disabled={submitting}
        />
        <Checkbox
          checked={acceptTerms}
          onChange={(checked) => {
            setAcceptTerms(checked);
            clearError("acceptTerms");
          }} error={errors.acceptTerms} disabled={submitting}>
          Я принимаю{" "}
          <Link to="/terms" className={styles.link} target="_blank" rel="noopener">
            пользовательское соглашение
          </Link>{" "}
          и{" "}
          <Link to="/privacy" className={styles.link} target="_blank" rel="noopener">
            политику конфиденциальности
          </Link>
        </Checkbox>
        <SubmitButton loading={submitting} loadingText="Переносим…">
          Перенести аккаунт
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
