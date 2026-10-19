import { useState, type FormEvent } from "react";
import { register } from "../../api/auth";
import type { Role } from "../../types/user";
import { loginUrl, safeNext, useLocation } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { AuthLayout } from "./AuthLayout";
import { CheckEmailScreen } from "./CheckEmailScreen";
import { Notice, PASSWORD_MIN_LENGTH, PasswordField, SubmitButton, TextField } from "./fields";
import { looksLikeEmail, toFormError } from "./authForm";
import { ConsentChecks, type ConsentState } from "./ConsentChecks";
import { CONSENTS_BY_ROLE, DOCUMENTS, type ConsentKey } from "../../legal/documents";
import styles from "./auth.module.css";

type FieldErrors = Partial<Record<"firstName" | "email" | "password" | "passwordConfirm" | "role", string>>;

const SERVER_FIELD: Record<string, keyof FieldErrors> = {
  first_name: "firstName",
  email: "email",
  password: "password",
  password_confirm: "passwordConfirm",
  role: "role",
};

const ROLES: { value: Role; title: string; hint: string }[] = [
  { value: "player", title: "Я игрок", hint: "Ищу тренера, веду тренировки и статистику" },
  { value: "coach", title: "Я тренер", hint: "Веду команды, публикую объявления и принимаю записи" },
];

export function RegisterPage() {
  const { search } = useLocation();
  const next = safeNext(new URLSearchParams(search).get("next"));

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [consents, setConsents] = useState<ConsentState>({});
  const [consentErrors, setConsentErrors] = useState<Partial<Record<ConsentKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  // A message about a field is stale as soon as the person edits that field.
  const clearError = (field: keyof FieldErrors) => setErrors((current) => ({ ...current, [field]: undefined }));

  if (sentTo) {
    // Everything typed stays in state, so "change the address" returns to a filled-in form.
    return <CheckEmailScreen email={sentTo} next={next} onChangeEmail={() => setSentTo(null)} />;
  }

  const chooseRole = (next: Role) => {
    if (next === role) return;
    setRole(next);
    // Boxes belong to a role: switching starts them over, so nothing ticked for the other role is ever sent.
    setConsents({});
    setConsentErrors({});
    clearError("role");
  };

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (!firstName.trim()) found.firstName = "Укажите имя.";
    if (!looksLikeEmail(email)) found.email = "Введите email полностью, например name@example.com.";
    const length = [...password].length;
    if (length < PASSWORD_MIN_LENGTH) found.password = `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`;
    if (password !== passwordConfirm) found.passwordConfirm = "Пароли не совпадают.";
    if (!role) found.role = "Выберите, кто вы: игрок или тренер.";
    return found;
  };

  const missingConsents = (): Partial<Record<ConsentKey, string>> => {
    const missing: Partial<Record<ConsentKey, string>> = {};
    if (!role) return missing;
    for (const consent of CONSENTS_BY_ROLE[role]) {
      if (!consents[consent.key]) missing[consent.key] = "Без этой отметки зарегистрироваться нельзя.";
    }
    return missing;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setEmailTaken(false);
    const found = validate();
    const missing = missingConsents();
    setErrors(found);
    setConsentErrors(missing);
    if (Object.keys(found).length > 0 || Object.keys(missing).length > 0 || !role) return;

    setSubmitting(true);
    try {
      const result = await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        passwordConfirm,
        role,
        consents: CONSENTS_BY_ROLE[role].map((consent) => ({
          key: consent.key,
          documents: consent.documents.map((doc) => ({ key: doc, version: DOCUMENTS[doc].version })),
        })),
        next,
      });
      setSentTo(result.email);
    } catch (err) {
      const failure = toFormError(err);
      const field = failure.field ? SERVER_FIELD[failure.field] : undefined;
      if (field) setErrors({ [field]: failure.message });
      else setFormError(failure.message);
      setEmailTaken(failure.code === "email_taken");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Создать аккаунт" lead="Выберите роль, заполните данные и отметьте согласия.">
      <form className={styles.form} onSubmit={submit} noValidate>
        {formError && <Notice kind="danger">{formError}</Notice>}

        {/* A <div role="radiogroup">, not a <fieldset>: older Safari cannot lay a fieldset out as a grid, which stretched the cards and broke the form. */}
        <div className={styles.roleGroup} role="radiogroup" aria-labelledby="role-legend">
          <p id="role-legend" className={styles.rolesLegend}>
            Кто вы? Роль выбирается один раз и потом не меняется
          </p>
          <div className={styles.roles}>
            {ROLES.map((option) => (
              <label key={option.value} className={`${styles.role} ${role === option.value ? styles.roleActive : ""}`}>
                <input
                  type="radio"
                  name="role"
                  className={styles.roleInput}
                  value={option.value}
                  checked={role === option.value}
                  disabled={submitting}
                  onChange={() => chooseRole(option.value)}
                />
                <span className={styles.roleName}>
                  <Icon name={option.value === "player" ? "user" : "users"} size={17} />
                  {option.title}
                </span>
                <span className={styles.roleHint}>{option.hint}</span>
              </label>
            ))}
          </div>
          {errors.role && (
            <p className={styles.fieldError} role="alert">
              {errors.role}
            </p>
          )}
        </div>

        <div className={styles.row2}>
          <TextField
            label="Имя"
            name="given-name"
            autoComplete="given-name"
            autoFocus
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              clearError("firstName");
            }}
            error={errors.firstName}
            disabled={submitting}
          />
          <TextField
            label="Фамилия"
            name="family-name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={submitting}
          />
        </div>

        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
            setEmailTaken(false);
          }}
          error={errors.email}
          disabled={submitting}
          placeholder="name@example.com"
        />
        {emailTaken && (
          <Notice kind="info">
            Этот адрес уже зарегистрирован.{" "}
            <Link to={loginUrl(next)} className={styles.link}>
              Войти
            </Link>{" "}
            или{" "}
            <Link to="/forgot-password" className={styles.link}>
              восстановить пароль
            </Link>
            .
          </Notice>
        )}

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
          hint={`Минимум ${PASSWORD_MIN_LENGTH} символов. Подойдёт фраза из нескольких слов — без особых правил.`}
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

        {role ? (
          <ConsentChecks
            role={role}
            value={consents}
            errors={consentErrors}
            disabled={submitting}
            onChange={(key, checked) => {
              setConsents((current) => ({ ...current, [key]: checked }));
              setConsentErrors((current) => ({ ...current, [key]: undefined }));
            }}
          />
        ) : (
          <p className={styles.footerLine}>Выберите роль — ниже появятся отметки, которые нужно поставить.</p>
        )}

        <SubmitButton loading={submitting} loadingText="Создаём аккаунт…">
          Зарегистрироваться
        </SubmitButton>
      </form>

      <p className={styles.footerLine}>
        Уже есть аккаунт?{" "}
        <Link to={loginUrl(next)} className={styles.link}>
          Войти
        </Link>
      </p>
    </AuthLayout>
  );
}
