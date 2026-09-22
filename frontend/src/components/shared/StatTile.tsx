import styles from "./StatTile.module.css";

interface StatTileProps {
  value: string | number;
  label: string;
  tone?: "default" | "dark";
  delta?: string;
}

/** Large hero-KPI number tile (56–72px range varies by placement; base
 * size 40px here, see docs/superpowers/specs/2026-08-17-mba-redesign-design.md
 * "Типографика"). `tone="dark"` renders as one of the fully-dark accent
 * cards the spec calls for regardless of the active theme. `delta` adds a
 * small caption line under the label (e.g. "+6% за 8 недель"). */
export function StatTile({ value, label, tone = "default", delta }: StatTileProps) {
  return (
    <div className={tone === "dark" ? `${styles.tile} ${styles.tileDark}` : styles.tile}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {delta && <span className={styles.delta}>{delta}</span>}
    </div>
  );
}
