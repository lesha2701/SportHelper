import { useState, type FormEvent } from "react";
import { resendVerification, verifyEmail } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import { navigate } from "../../router";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { AuthLayout } from "./AuthLayout";
import { Notice, TextField } from "./fields";
import { toFormError, useCooldown, type FormError } from "./authForm";
import styles from "./auth.module.css";

/** "Check your mail" - where everyone lands after signing up or claiming an
 * account. Never a dead end: resend, fix a mistyped address, or go sign in. */
export function CheckEmailScreen({
  email,
  onChangeEmail,
  next = null,
  coach = false,
  confirmationPassword,
}: {
  email: string;
  onChangeEmail?: () => void;
  /** Where the person was heading; carried through the confirmation email. */
  next?: string | null;
  coach?: boolean;
  /** Kept only in the current registration tab; never stored in the browser. */
  confirmationPassword?: string;
}) {
  const { signIn } = useAuth();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const cooldown = useCooldown(60);

  const confirmCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmationPassword || !/^\d{8}$/.test(code)) { setError({ message: 'Введите восьмизначный код из письма.', field: null, code: 'invalid_code', retryAfter: null }); return; }
    setVerifying(true); setError(null);
    try {
      const result = await verifyEmail(code, confirmationPassword);
      if (result.session) { signIn(result.session); navigate(next ?? '/', { replace: true }); }
      else navigate('/login', { replace: true });
    } catch (err) { setError(toFormError(err)); }
    finally { setVerifying(false); }
  };

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      await resendVerification(email, next);
      setSent(true);
      cooldown.start();
    } catch (err) {
      setError(toFormError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthLayout title="Проверьте почту">
      <div className={styles.statusIcon}>
        <Icon name="mail" size={30} />
      </div>
      <p className={styles.lead} style={{ margin: 0 }}>
        {confirmationPassword ? <>Мы отправили восьмизначный код на <span className={styles.address}>{email}</span>. Введите его ниже — {coach ? 'заявка сразу появится на проверке' : 'вы сразу попадёте в приложение'}.</> : <>Мы отправили письмо со ссылкой на <span className={styles.address}>{email}</span>. Откройте его, нажмите «Подтвердить email» и введите пароль — вы сразу попадёте в приложение. Ссылка действует 24 часа.</>}
      </p>

      <div className={styles.stack}>
        {confirmationPassword && <form className={styles.form} onSubmit={confirmCode}>
          <TextField label="Код из письма" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} required />
          <button type="submit" className={styles.primary} disabled={verifying || code.length !== 8}>{verifying ? 'Проверяем…' : 'Подтвердить почту'}</button>
        </form>}
        {sent && cooldown.remaining > 0 && <Notice kind="success">Письмо отправлено ещё раз. Проверьте и папку «Спам».</Notice>}
        {error && <Notice kind="danger">{error.message}</Notice>}
        <button type="button" className={styles.secondary} onClick={resend} disabled={sending || cooldown.remaining > 0}>
          {cooldown.remaining > 0 ? `Отправить ещё раз (${cooldown.remaining})` : sending ? "Отправляем…" : "Отправить письмо ещё раз"}
        </button>
        {!confirmationPassword && <Link to={`/login?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`} className={styles.primary}>Я подтвердил — войти</Link>}
      </div>

      <p className={styles.footerLine}>
        Письмо не приходит?{" "}
        {onChangeEmail ? (
          <button type="button" className={styles.linkButton} onClick={onChangeEmail}>
            Изменить адрес
          </button>
        ) : (
          <Link to="/register" className={styles.link}>
            Зарегистрироваться заново
          </Link>
        )}
      </p>
    </AuthLayout>
  );
}
