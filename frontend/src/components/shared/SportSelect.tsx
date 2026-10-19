import { COMMON_SPORTS } from "../../types/profile";
import styles from "../profile/profile.module.css";

interface SportSelectProps {
  value: string;
  onChange: (sport: string) => void;
  label?: string;
  required?: boolean;
  /** Without it the empty choice is allowed (a filter-like use). */
  placeholder?: string;
  disabled?: boolean;
}

/** The sport picker used by every form. A value that is not in the list (an older record) stays selectable. */
export function SportSelect({ value, onChange, label = "Вид спорта", required = true, placeholder = "Выберите вид спорта", disabled }: SportSelectProps) {
  const legacy = value && !COMMON_SPORTS.includes(value) ? value : null;
  return (
    <label className={styles.field}>
      <span className={styles.label}>
        {label}
        {required && <span className={styles.requiredMark}>*</span>}
      </span>
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled}>
        <option value="">{placeholder}</option>
        {legacy && <option value={legacy}>{legacy}</option>}
        {COMMON_SPORTS.map((sport) => (
          <option key={sport} value={sport}>
            {sport}
          </option>
        ))}
      </select>
    </label>
  );
}
