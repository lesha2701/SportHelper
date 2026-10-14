import { useState } from "react";
import { resendVerification } from "../../api/auth";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { AuthLayout } from "./AuthLayout";
import { Notice } from "./fields";
import { toFormError, useCooldown, type FormError } from "./authForm";
import styles from "./auth.module.css";

/** "Check your mail" - where everyone lands after signing up or claiming an
 * account. Never a dead end: resend, fix a mistyped address, or go sign in. */
export function CheckEmailScreen({
  email,
  onChangeEmail,
  next = null,
}: {
  email: string;
  onChangeEmail?: () => void;
  /** Where the person was heading; carried through the confirmation email. */
  next?: string | null;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const cooldown = useCooldown(60);

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
        Мы отправили письмо со ссылкой на <span className={styles.address}>{email}</span>. Откройте его и нажмите «Подтвердить
        email» — после этого можно войти. Ссылка действует 24 часа.
      </p>

      <div className={styles.stack}>
        {sent && cooldown.remaining > 0 && <Notice kind="success">Письмо отправлено ещё раз. Проверьте и папку «Спам».</Notice>}
        {error && <Notice kind="danger">{error.message}</Notice>}
        <button type="button" className={styles.secondary} onClick={resend} disabled={sending || cooldown.remaining > 0}>
          {cooldown.remaining > 0 ? `Отправить ещё раз (${cooldown.remaining})` : sending ? "Отправляем…" : "Отправить письмо ещё раз"}
        </button>
        <Link to={`/login?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`} className={styles.primary}>
          Я подтвердил — войти
        </Link>
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
