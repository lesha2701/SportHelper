import { useId } from "react";
import type { DayCount } from "../../api/admin";
import styles from "./admin.module.css";

const W = 480;
const H = 170;
const PAD = { top: 12, right: 8, bottom: 22, left: 30 };

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

/** Round-ish axis maximum so the top tick is a readable number. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

/** A daily series drawn as bars (counts of things that happened that day). */
export function BarChart({ data, label }: { data: DayCount[]; label: string }) {
  const total = data.reduce((sum, p) => sum + p.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>Пока нет данных за последние 30 дней</div>;
  const max = niceMax(Math.max(...data.map((p) => p.count)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  return (
    <svg className={styles.chartBox} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Grid max={max} innerW={innerW} innerH={innerH} />
      {data.map((p, i) => {
        const h = (p.count / max) * innerH;
        return (
          <rect key={p.day} className={p.count ? styles.chartBar : styles.chartBarMuted} x={PAD.left + i * slot + slot * 0.15} y={PAD.top + innerH - Math.max(h, p.count ? 1 : 0)} width={slot * 0.7} height={Math.max(h, p.count ? 1 : 0)} rx={1.5}>
            <title>{`${shortDay(p.day)}: ${p.count}`}</title>
          </rect>
        );
      })}
      <DayLabels data={data} slot={slot} />
    </svg>
  );
}

/** The same kind of series as a line with a soft area (a level, e.g. active people per day). */
export function LineChart({ data, label }: { data: DayCount[]; label: string }) {
  const gradient = useId();
  const total = data.reduce((sum, p) => sum + p.count, 0);
  if (total === 0) return <div className={styles.chartEmpty}>Пока нет данных: учёт активности начинается с момента запуска</div>;
  const max = niceMax(Math.max(...data.map((p) => p.count)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const points = data.map((p, i) => [PAD.left + i * slot + slot / 2, PAD.top + innerH - (p.count / max) * innerH] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1]![0].toFixed(1)} ${PAD.top + innerH} L${points[0]![0].toFixed(1)} ${PAD.top + innerH} Z`;
  return (
    <svg className={styles.chartBox} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Grid max={max} innerW={innerW} innerH={innerH} />
      <path d={area} fill={`url(#${gradient})`} />
      <path d={line} className={styles.chartLine} />
      {points.map(([x, y], i) => (
        <circle key={data[i]!.day} cx={x} cy={y} r={data[i]!.count ? 2.6 : 1.4} fill="var(--color-primary)">
          <title>{`${shortDay(data[i]!.day)}: ${data[i]!.count}`}</title>
        </circle>
      ))}
      <DayLabels data={data} slot={slot} />
    </svg>
  );
}

function Grid({ max, innerW, innerH }: { max: number; innerW: number; innerH: number }) {
  return (
    <g>
      {[0, 0.5, 1].map((t) => {
        const y = PAD.top + innerH - t * innerH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={t ? "3 3" : undefined} />
            <text className={styles.chartAxis} x={PAD.left - 5} y={y + 3} textAnchor="end">
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DayLabels({ data, slot }: { data: DayCount[]; slot: number }) {
  const every = Math.ceil(data.length / 6);
  return (
    <g>
      {data.map((p, i) =>
        i % every === 0 || i === data.length - 1 ? (
          <text key={p.day} className={styles.chartAxis} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle">
            {shortDay(p.day)}
          </text>
        ) : null,
      )}
    </g>
  );
}
