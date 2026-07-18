import type { ChangeEvent } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./FilePicker.module.css";

interface FilePickerProps {
  accept: string;
  onSelect: (file: File) => void;
  disabled?: boolean;
  icon: IconName;
  label: string;
  hint?: string;
  fileName?: string | null;
}

export function FilePicker({ accept, onSelect, disabled, icon, label, hint, fileName }: FilePickerProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onSelect(file);
  };

  return (
    <div className={disabled ? `${styles.picker} ${styles.pickerDisabled}` : styles.picker}>
      <span className={styles.pickerIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.pickerText}>
        <span className={styles.pickerLabel}>{fileName ?? label}</span>
        {hint && <span className={styles.pickerHint}>{hint}</span>}
      </span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
        className={styles.hiddenInput}
        aria-label={label}
      />
    </div>
  );
}
