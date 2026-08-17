import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Collapsed-by-default wrapper for optional/secondary form fields — see
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Layout / IA",
 * point 1 (progressive disclosure in creation forms). Pass
 * `defaultOpen={isEdit}` from the calling form so editing an existing
 * record never hides its own already-set values behind a collapsed
 * section. */
export function CollapsibleSection({ label, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.section}>
      <button type="button" className={styles.toggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}>
          <Icon name="chevron-right" size={16} />
        </span>
      </button>
      {open && <div className={styles.body}>{children}</div>}
    </div>
  );
}
