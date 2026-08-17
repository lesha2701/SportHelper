// frontend/src/components/shared/CollapsibleSection.tsx

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  label: string;
  defaultOpen?: boolean;
  /** Bump this (e.g. a counter incremented after an AI draft or similar
   * out-of-band fill writes values into this section's fields) to force
   * the section open even if the user hasn't touched it. Only fires on a
   * later change — never on initial mount, so it never fights
   * `defaultOpen`'s own initial value. */
  forceOpenKey?: number;
  children: ReactNode;
}

/** Collapsed-by-default wrapper for optional/secondary form fields — see
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Layout / IA",
 * point 1 (progressive disclosure in creation forms). Pass
 * `defaultOpen={isEdit}` from the calling form so editing an existing
 * record never hides its own already-set values behind a collapsed
 * section. If something outside the user's own typing (an AI draft, a
 * template prefill applied after mount) can write into this section's
 * fields, also pass `forceOpenKey` so the section opens the moment that
 * happens. */
export function CollapsibleSection({ label, defaultOpen = false, forceOpenKey, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (forceOpenKey !== undefined) {
      setOpen(true);
    }
  }, [forceOpenKey]);
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
