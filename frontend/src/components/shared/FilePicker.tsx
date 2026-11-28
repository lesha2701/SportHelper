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

interface MultiFilePickerProps {
  accept: string;
  onSelect: (files: File[]) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
  files?: File[];
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
      <span className={styles.pickerAction} aria-hidden="true">Выбрать</span>
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

/** Shared styled control for forms that accept several files at once. */
export function MultiFilePicker({ accept, onSelect, disabled, label, hint, files = [] }: MultiFilePickerProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length) onSelect(selected);
  };

  return (
    <div className={disabled ? `${styles.picker} ${styles.pickerDisabled}` : styles.picker}>
      <span className={styles.pickerIcon}><Icon name="paperclip" size={18} /></span>
      <span className={styles.pickerText}>
        <span className={styles.pickerLabel}>{label}</span>
        <span className={styles.pickerHint} aria-live="polite">
          {files.length ? files.map(file => file.name).join(', ') : hint ?? 'Файлы не выбраны'}
        </span>
      </span>
      <span className={styles.pickerAction} aria-hidden="true">Прикрепить</span>
      <input type="file" accept={accept} multiple disabled={disabled} onChange={handleChange} className={styles.hiddenInput} aria-label={label} />
    </div>
  );
}
