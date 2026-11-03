/** Decorative wave-stripe motif from the MBA design system (see
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Орнамент").
 * Absolutely positioned to fill its parent — the parent must set
 * position: relative and overflow: hidden. Never place interactive
 * elements or dense data behind it; it's decoration only. */
interface OrnamentProps {
  tone?: "primary" | "graphite" | "blush";
  intensity?: "subtle" | "bold";
  className?: string;
  /** Draw the stripes entirely inside the box, with rounded ends, instead of bleeding off its edges. */
  contained?: boolean;
}

const TONE_COLORS: Record<NonNullable<OrnamentProps["tone"]>, string> = {
  primary: "var(--color-primary)",
  graphite: "var(--color-graphite)",
  blush: "var(--color-accent-blue)",
};

export function Ornament({ tone = "primary", intensity = "subtle", className, contained = false }: OrnamentProps) {
  const opacity = intensity === "bold" ? 1 : 0.1;
  const color = TONE_COLORS[tone];
  const [x0, x1, xc] = contained ? [20, 380, 340] : [-20, 440, 380];
  return (
    <svg
      className={className}
      viewBox={contained ? "0 -50 400 180" : "0 0 400 120"}
      preserveAspectRatio={contained ? "xMidYMid meet" : "none"}
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, pointerEvents: "none", overflow: contained ? "visible" : undefined }}
    >
      <path
        d={`M${x0} 90 C 60 40, 140 140, 220 60 S ${xc} 20, ${x1} 70`}
        stroke={color}
        strokeWidth="26"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M${x0} 40 C 60 -10, 140 90, 220 10 S ${xc} -30, ${x1} 20`}
        stroke={color}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M${x0} 110 C 60 60, 140 160, 220 80 S ${xc} 40, ${x1} 90`}
        stroke={color}
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
