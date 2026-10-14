import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";
import styles from "./auth.module.css";

interface BaseFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  /** Shown to the right of the label (e.g. "Забыли пароль?"). */
  labelAside?: ReactNode;
}

function describedBy(id: string, error?: string | null, hint?: ReactNode): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function TextField({ label, error, hint, labelAside, ...input }: BaseFieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {labelAside}
      </div>
      <div className={styles.inputWrap}>
        <input
          {...input}
          id={id}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Length progress toward the minimum. Deliberately says nothing about
 * capitals/digits/symbols: only length (and the server's blocklist) matter. */
function LengthMeter({ length, min }: { length: number; min: number }) {
  if (length === 0) return null;
  const strong = length >= 16;
  const ok = length >= min;
  const percent = Math.min(100, Math.round((length / 16) * 100));
  const text = ok ? (strong ? "Надёжный" : "Достаточно") : `Ещё ${min - length}`;
  return (
    <div className={styles.meter} aria-hidden="true">
      <span className={styles.meterTrack}>
        <span
          className={`${styles.meterFill} ${ok ? styles.meterFillOk : ""} ${strong ? styles.meterFillStrong : ""}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className={styles.meterText}>{text}</span>
    </div>
  );
}

export const PASSWORD_MIN_LENGTH = 12;

interface PasswordFieldProps extends Omit<BaseFieldProps, "type"> {
  /** Show the progress meter (sign-up / new password), not on plain login. */
  showMeter?: boolean;
}

/** A password input with a show/hide button. `autoComplete` must be set
 * (`current-password` / `new-password`) so password managers behave. */
export function PasswordField({ label, error, hint, labelAside, showMeter, value, ...input }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const text = typeof value === "string" ? value : "";
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {labelAside}
      </div>
      <div className={styles.inputWrap}>
        <input
          {...input}
          value={value}
          id={id}
          type={visible ? "text" : "password"}
          className={`${styles.input} ${styles.inputWithToggle}`}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
        />
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          aria-pressed={visible}
        >
          <Icon name={visible ? "eye-off" : "eye"} size={19} />
        </button>
      </div>
      {showMeter && <LengthMeter length={[...text].length} min={PASSWORD_MIN_LENGTH} />}
      {error && (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  error,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ loading, loadingText, children }: { loading: boolean; loadingText: string; children: ReactNode }) {
  return (
    <button type="submit" className={styles.primary} disabled={loading} aria-busy={loading}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {loading ? loadingText : children}
    </button>
  );
}

type NoticeKind = "info" | "success" | "danger";

const NOTICE_ICON: Record<NoticeKind, IconName> = { info: "mail", success: "check-circle", danger: "alert-triangle" };

export function Notice({ kind = "info", children }: { kind?: NoticeKind; children: ReactNode }) {
  const className = { info: styles.noticeInfo, success: styles.noticeSuccess, danger: styles.noticeDanger }[kind];
  return (
    <div className={`${styles.notice} ${className}`} role={kind === "danger" ? "alert" : "status"}>
      <span className={styles.noticeIcon}>
        <Icon name={NOTICE_ICON[kind]} size={18} />
      </span>
      <div>{children}</div>
    </div>
  );
}
