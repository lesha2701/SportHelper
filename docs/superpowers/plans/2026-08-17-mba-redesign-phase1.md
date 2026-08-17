# MBA Redesign — Phase 1 (Core + Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MBA design-system core (color/type/shape tokens, ornament + KPI-number primitives) and a new Dashboard screen assembled from existing APIs, ready for the user to review live on the dev stack before Phases 2–5 (team hub, form sectioning, mechanical rollout, mobile QA) proceed.

**Architecture:** Extend the existing token-driven system (`frontend/src/index.css` + CSS Modules) in place — this repo already re-themes ~50 screens from 8 shared CSS files, so most existing screens re-tint automatically once tokens change. Add exactly two new shared primitives (`Ornament`, `StatTile`) and one new screen (`DashboardScreen`, split into `CoachDashboard`/`PlayerDashboard`). No backend changes.

**Tech Stack:** React 19 + TypeScript + Vite, CSS Modules, existing `frontend/src/api/*` clients (`getCalendar`, `getTeamStats`, `getPlayerStats`, `listMyTeams`).

## Global Constraints

- No backend/database changes anywhere in this plan.
- No new npm dependencies — everything is plain CSS/SVG/React, consistent with the current frontend (no test runner exists in this project; verification is `npm run lint`, `npm run build`, and manual visual check on the dev stack, not unit tests).
- Follow `docs/superpowers/specs/2026-08-17-mba-redesign-design.md` exactly for color values, radii, and rules — do not improvise new values.
- Every existing CSS custom property that other files already reference (`--color-primary-glow`, `--color-accent-blue`, `--color-link`, `--color-danger`, etc.) keeps its **name** even where its color value changes — renaming would silently break the ~45 screens not touched in this phase.
- Dev stack for manual verification: `docker compose -f docker-compose.dev.yml up -d backend frontend` (already configured, see `docs/dev-notes.md`), frontend at `http://localhost:5175`, backend at `http://localhost:8002`. Run `npm` commands via `docker compose -f docker-compose.dev.yml exec frontend <cmd>`.

---

### Task 1: Retint tokens — `index.css`, light becomes default theme

**Files:**
- Modify: `frontend/src/index.css:1-95` (the two `:root` blocks)
- Modify: `frontend/index.html:7` (theme-color meta), `frontend/index.html:9-23` (inline theme-detection script)
- Modify: `frontend/src/context/ThemeContext.tsx:7-10` (`readInitialTheme` default)

**Interfaces:**
- Produces: every CSS custom property consumed by the 7 `*.module.css` files and all `.tsx` inline styles (`--color-bg`, `--color-surface`, `--color-surface-alt`, `--color-text*`, `--color-border*`, `--color-primary*`, `--color-accent-blue`, `--color-link`, `--color-success*`, `--color-danger*`, `--color-warning*`, `--radius-*`, `--shadow-*`, `--color-graphite`, `--color-graphite-elevated`) — no consumer file changes required for the retint itself, values only.

- [ ] **Step 1: Replace the token block in `index.css`**

Replace lines 1–95 (from the top comment through the end of the `@media (prefers-reduced-motion...)` block start — keep the reduced-motion block itself, see step below) with:

```css
:root {
  /* TeamFlow Sports — MBA design system. Light is the primary/default
     theme (see docs/superpowers/specs/2026-08-17-mba-redesign-design.md);
     [data-theme="dark"] below is a full, equally-supported secondary theme,
     not a fallback. Theme selection happens before first paint via the
     inline script in index.html (localStorage "tf-theme" ->
     prefers-color-scheme -> light), which sets documentElement.dataset.theme. */
  --color-bg: #fafafa;
  --color-bg-elevated: #ffffff;
  --color-surface: #ffffff;
  --color-surface-alt: #f2f1ef;
  --color-text: #17181b;
  --color-text-secondary: #5c5e66;
  --color-text-tertiary: #96979e;
  --color-border: #e7e6e3;
  --color-border-strong: #d6d4cf;

  --color-graphite: #17181b;
  --color-graphite-elevated: #1f2024;

  --color-primary: #d91e2b;
  --color-primary-hover: #b8121e;
  --color-primary-text: #ffffff;
  --color-primary-glow: #fbeae9;

  --color-accent-blue: #f2a6a0;
  --color-link: var(--color-primary);

  --color-success: #1f9d5c;
  --color-success-bg: #eafaf1;
  --color-danger: #e85d2a;
  --color-danger-bg: #fdf0e9;
  --color-warning: #b6790f;
  --color-warning-bg: #fdf3e0;

  --radius-lg: 12px;
  --radius-md: 8px;
  --radius-sm: 4px;
  --radius-pill: 999px;

  --shadow-card: 0 1px 2px rgba(23, 24, 27, 0.04), 0 1px 3px rgba(23, 24, 27, 0.08);
  --shadow-raised: 0 12px 28px rgba(217, 30, 43, 0.14);

  --font-body: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-display: "Barlow Condensed", var(--font-body);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast: 150ms var(--ease-out);
  --transition-base: 220ms var(--ease-out);

  color-scheme: light;
  font: 15px/1.45 var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

:root[data-theme="dark"] {
  --color-bg: #121214;
  --color-bg-elevated: #1c1d20;
  --color-surface: #1c1d20;
  --color-surface-alt: #26272b;
  --color-text: #f2f1ef;
  --color-text-secondary: #a8a9ae;
  --color-text-tertiary: #6e6f75;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.14);

  --color-graphite: #f2f1ef;
  --color-graphite-elevated: #17181b;

  --color-primary: #ff3b3f;
  --color-primary-hover: #ff5a5d;
  --color-primary-text: #ffffff;
  --color-primary-glow: rgba(255, 59, 63, 0.16);

  --color-accent-blue: #e8918c;

  --color-success: #34c778;
  --color-success-bg: rgba(52, 199, 120, 0.14);
  --color-danger: #ff7a4d;
  --color-danger-bg: rgba(255, 122, 77, 0.14);
  --color-warning: #f5a623;
  --color-warning-bg: rgba(245, 166, 35, 0.14);

  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.34), 0 4px 14px rgba(0, 0, 0, 0.3);
  --shadow-raised: 0 10px 26px rgba(255, 59, 63, 0.22), 0 4px 12px rgba(0, 0, 0, 0.4);

  color-scheme: dark;
}
```

Everything below the old second `:root[data-theme="light"]` block (the `@media (prefers-reduced-motion...)` rule and everything after it — `*`, `html, body`, `body`, `#root`, `h1,h2,h3,p`, `button`, focus-visible rules, `img`, `a`, `::selection`, scrollbar rules) stays **unchanged** — those don't hardcode colors, they reference the tokens above.

- [ ] **Step 2: Flip the pre-paint theme default in `index.html`**

In `frontend/index.html`, replace:

```html
    <meta name="theme-color" content="#0C1324" />
```

with:

```html
    <meta name="theme-color" content="#FAFAFA" />
```

And replace the inline script body (lines 9–23):

```html
    <script>
      (function () {
        try {
          var stored = localStorage.getItem("tf-theme");
          var theme =
            stored === "light" || stored === "dark"
              ? stored
              : window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
                ? "light"
                : "dark";
          document.documentElement.dataset.theme = theme;
        } catch (e) {
          document.documentElement.dataset.theme = "dark";
        }
      })();
    </script>
```

with:

```html
    <script>
      (function () {
        try {
          var stored = localStorage.getItem("tf-theme");
          var theme =
            stored === "light" || stored === "dark"
              ? stored
              : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light";
          document.documentElement.dataset.theme = theme;
        } catch (e) {
          document.documentElement.dataset.theme = "light";
        }
      })();
    </script>
```

- [ ] **Step 3: Flip the in-app theme default in `ThemeContext.tsx`**

In `frontend/src/context/ThemeContext.tsx`, replace:

```ts
function readInitialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}
```

with:

```ts
function readInitialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "dark" ? "dark" : "light";
}
```

(`toggleTheme`'s `current === "dark" ? "light" : "dark"` logic already works correctly for either default — no change needed there.)

- [ ] **Step 4: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0 (tsc + vite build succeed — this is a pure CSS/HTML change, so a passing build here means nothing referencing these files broke).

- [ ] **Step 5: Manual visual check**

Open `http://localhost:5175` in a browser (dev-login logs you in automatically, see `docs/dev-notes.md`). Confirm: background is near-white (not the old dark navy), primary buttons/accents are red, toggling the theme switch in Profile flips to a dark-graphite (not dark-navy) theme with a brighter red accent.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/index.css frontend/index.html frontend/src/context/ThemeContext.tsx
git commit -m "MBA redesign: retint tokens, light theme becomes default"
```

---

### Task 2: Flatten the bottom-nav active indicator (drop the blue gradient)

**Files:**
- Modify: `frontend/src/components/nav/BottomNav.module.css:52`

**Interfaces:**
- Consumes: `--color-primary` (from Task 1).

- [ ] **Step 1: Replace the gradient with a flat red bar**

Replace:

```css
  background: linear-gradient(90deg, var(--color-primary), var(--color-accent-blue));
```

with:

```css
  background: var(--color-primary);
```

- [ ] **Step 2: Verify lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual visual check**

Open `http://localhost:5175`, confirm the active bottom-nav item shows a solid red bar above its icon, not a red-to-pink gradient.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/nav/BottomNav.module.css
git commit -m "MBA redesign: flat red active-nav indicator, no gradient"
```

---

### Task 3: Bump heading scale (`.heading` / `.pageHeading`) and add tabular-nums to `.statValue`

**Files:**
- Modify: `frontend/src/components/teams/teams.module.css:25-33` (`.heading`), `:351-358` (`.statValue`)
- Modify: `frontend/src/components/profile/profile.module.css` (find and modify the `.pageHeading` rule — search for `.pageHeading` in that file; it mirrors `.heading` above per `frontend/design-system/teamflow-sports/MASTER.md`)

**Interfaces:**
- No new interfaces — pure visual scale changes to existing shared classes already consumed across the app.

- [ ] **Step 1: Bump `.heading` in `teams.module.css`**

Replace:

```css
.heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--color-text);
}
```

with:

```css
.heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--color-text);
}
```

- [ ] **Step 2: Add `tabular-nums` to `.statValue` in `teams.module.css`**

Replace:

```css
.statValue {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--color-primary);
  overflow-wrap: break-word;
}
```

with:

```css
.statValue {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--color-primary);
  overflow-wrap: break-word;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Bump `.pageHeading` in `profile.module.css`**

Replace:

```css
.pageHeading {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--color-text);
  margin: 0;
}
```

with:

```css
.pageHeading {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--color-text);
  margin: 0;
}
```

- [ ] **Step 4: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 5: Manual visual check**

Open `http://localhost:5175`, navigate to Команды — confirm the "Команды" heading is visibly larger than before (28px vs 24px). Open Профиль → confirm any page-heading-styled title (e.g. a form title) grew the same way.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/teams/teams.module.css frontend/src/components/profile/profile.module.css
git commit -m "MBA redesign: larger page headings, tabular-nums on stat values"
```

---

### Task 4: Add a `home` icon

**Files:**
- Modify: `frontend/src/components/shared/Icon.tsx:3-36` (the `IconName` union), `:38-214` (the `PATHS` map)

**Interfaces:**
- Produces: `IconName` now includes `"home"`, usable as `<Icon name="home" />` — consumed by Task 10 (bottom nav "Главная" tab).

- [ ] **Step 1: Add `"home"` to the `IconName` union**

In the `export type IconName =` union (starts line 3), add `| "home"` as the first member, right after the opening `export type IconName =` line:

```ts
export type IconName =
  | "home"
  | "trophy"
  | "book"
```

(leave the rest of the union exactly as-is).

- [ ] **Step 2: Add the `home` path**

In the `PATHS` map (starts line 38), add a `home` entry as the first key, right after `const PATHS: Record<IconName, ReactElement> = {`:

```tsx
const PATHS: Record<IconName, ReactElement> = {
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5a1 1 0 0 0 1 1h3.5v-6h3v6H17a1 1 0 0 0 1-1V10" />
    </>
  ),
  trophy: (
```

- [ ] **Step 3: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0 (a missing `PATHS` entry for a declared `IconName` would fail the `Record<IconName, ReactElement>` type check, so a clean build proves both edits are in sync).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/Icon.tsx
git commit -m "MBA redesign: add home icon for the new Dashboard nav tab"
```

---

### Task 5: `Ornament` shared component

**Files:**
- Create: `frontend/src/components/shared/Ornament.tsx`

**Interfaces:**
- Produces: `Ornament({ tone?: "primary" | "graphite" | "blush"; intensity?: "subtle" | "bold"; className?: string })` — a `<svg>` that absolutely fills its nearest positioned ancestor. Consumed by Task 7/8 (`CoachDashboard`/`PlayerDashboard` hero header) — the parent element must set `position: relative` and `overflow: hidden`.

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/shared/Ornament.tsx
/** Decorative wave-stripe motif from the MBA design system (see
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Орнамент").
 * Absolutely positioned to fill its parent — the parent must set
 * position: relative and overflow: hidden. Never place interactive
 * elements or dense data behind it; it's decoration only. */
interface OrnamentProps {
  tone?: "primary" | "graphite" | "blush";
  intensity?: "subtle" | "bold";
  className?: string;
}

const TONE_COLORS: Record<NonNullable<OrnamentProps["tone"]>, string> = {
  primary: "var(--color-primary)",
  graphite: "var(--color-graphite)",
  blush: "var(--color-accent-blue)",
};

export function Ornament({ tone = "primary", intensity = "subtle", className }: OrnamentProps) {
  const opacity = intensity === "bold" ? 1 : 0.1;
  const color = TONE_COLORS[tone];
  return (
    <svg
      className={className}
      viewBox="0 0 400 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, pointerEvents: "none" }}
    >
      <path
        d="M-20 90 C 60 40, 140 140, 220 60 S 380 20, 440 70"
        stroke={color}
        strokeWidth="26"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-20 40 C 60 -10, 140 90, 220 10 S 380 -30, 440 20"
        stroke={color}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-20 110 C 60 60, 140 160, 220 80 S 380 40, 440 90"
        stroke={color}
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0. (Nothing imports this yet, so this alone doesn't change any rendered screen — it's exercised visually in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/shared/Ornament.tsx
git commit -m "MBA redesign: add Ornament wave-stripe shared component"
```

---

### Task 6: `StatTile` shared component (hero KPI numbers)

**Files:**
- Create: `frontend/src/components/shared/StatTile.tsx`
- Create: `frontend/src/components/shared/StatTile.module.css`

**Interfaces:**
- Produces: `StatTile({ value: string | number; label: string; tone?: "default" | "dark" })`. Consumed by Task 7/8 (`CoachDashboard`/`PlayerDashboard` KPI row).
- Distinct from the existing smaller `.statGrid`/`.statTile`/`.statValue` pattern in `teams.module.css` (22px numbers, used for compact in-card stats) — this is the large (40px) hero-KPI variant called out in the spec's "Типографика" section. Both patterns stay; do not merge them.

- [ ] **Step 1: Create the CSS module**

```css
/* frontend/src/components/shared/StatTile.module.css */
.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.tileDark {
  background: var(--color-graphite-elevated);
  border-color: var(--color-graphite-elevated);
}

.tileDark .value {
  color: var(--color-primary);
}

.tileDark .label {
  color: rgba(255, 255, 255, 0.64);
}

.value {
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 800;
  line-height: 1;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}

.label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: Create the component**

```tsx
// frontend/src/components/shared/StatTile.tsx
import styles from "./StatTile.module.css";

interface StatTileProps {
  value: string | number;
  label: string;
  tone?: "default" | "dark";
}

/** Large hero-KPI number tile (56–72px range varies by placement; base
 * size 40px here, see docs/superpowers/specs/2026-08-17-mba-redesign-design.md
 * "Типографика"). `tone="dark"` renders as one of the fully-dark accent
 * cards the spec calls for regardless of the active theme. */
export function StatTile({ value, label, tone = "default" }: StatTileProps) {
  return (
    <div className={tone === "dark" ? `${styles.tile} ${styles.tileDark}` : styles.tile}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/StatTile.tsx frontend/src/components/shared/StatTile.module.css
git commit -m "MBA redesign: add StatTile hero-KPI shared component"
```

---

### Task 7: `CoachDashboard` + shared `dashboard.module.css`

**Files:**
- Create: `frontend/src/components/dashboard/dashboard.module.css`
- Create: `frontend/src/components/dashboard/CoachDashboard.tsx`

**Interfaces:**
- Consumes: `listMyTeams(token): Promise<Team[]>` and `getCalendar(token, dateFrom, dateTo): Promise<CalendarEvent[]>` (`frontend/src/api/teams.ts`, `frontend/src/api/calendar.ts`), `getTeamStats(token, teamId): Promise<TeamStats>` (`frontend/src/api/stats.ts`), `StateScreen` (`frontend/src/components/StateScreen.tsx`), `Icon`/`Ornament`/`StatTile` (`frontend/src/components/shared/*`), `CALENDAR_EVENT_ICONS` (`frontend/src/types/calendar.ts`), `Team`/`TeamRole` (`frontend/src/types/team.ts`), `TeamStats` (`frontend/src/types/stats.ts`), `.navRow`/`.navRowIcon`/`.navRowLabel`/`.navRowChevron` classes from `frontend/src/components/teams/teams.module.css`.
- Produces: `CoachDashboard({ token, onOpenEvent, onOpenTeam }: { token: string; onOpenEvent: (event: CalendarEvent) => void; onOpenTeam: (teamId: string) => void })`. Consumed by Task 9 (`DashboardScreen`).
- Produces (shared, reused by Task 8): `dashboard.module.css` classes `.screen`, `.hero`, `.heroLabel`, `.heroTitle`, `.nextEventCard`, `.nextEventText`, `.nextEventLabel`, `.nextEventTitle`, `.nextEventMeta`, `.emptyHint`, `.kpiRow`, `.teamSwitcher`, `.chip`, `.chipActive`, `.recommendationCard`, `.quickAction`.

- [ ] **Step 1: Create `dashboard.module.css`**

```css
/* frontend/src/components/dashboard/dashboard.module.css
   Shared between CoachDashboard and PlayerDashboard. */
.screen {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  padding-bottom: 32px;
}

.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 18px;
  border-radius: var(--radius-lg);
  background: var(--color-graphite-elevated);
  color: #ffffff;
}

.heroLabel {
  position: relative;
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.64);
}

.heroTitle {
  position: relative;
  margin: 0;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.nextEventCard {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  color: var(--color-primary);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: transform var(--transition-fast);
}

.nextEventCard:active {
  transform: scale(0.99);
}

.nextEventText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nextEventLabel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}

.nextEventTitle {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
}

.nextEventMeta {
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.emptyHint {
  margin: 0;
  padding: 12px 4px;
  font-size: 13.5px;
  color: var(--color-text-secondary);
}

.kpiRow {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.teamSwitcher {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}

.chip,
.chipActive {
  flex-shrink: 0;
  padding: 7px 14px;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  cursor: pointer;
  white-space: nowrap;
  transition: transform var(--transition-fast);
}

.chip {
  background: var(--color-surface);
  color: var(--color-text-secondary);
}

.chipActive {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-primary-text);
}

.chip:active,
.chipActive:active {
  transform: scale(0.96);
}

.recommendationCard {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: var(--color-primary-glow);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-lg);
  color: var(--color-primary);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.quickAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--color-primary-text);
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform var(--transition-fast), background-color var(--transition-fast);
}

.quickAction:active {
  transform: scale(0.97);
  background: var(--color-primary-hover);
}
```

- [ ] **Step 2: Create `CoachDashboard.tsx`**

```tsx
// frontend/src/components/dashboard/CoachDashboard.tsx
import { useCallback, useEffect, useState } from "react";
import { listMyTeams } from "../../api/teams";
import { getCalendar } from "../../api/calendar";
import { getTeamStats } from "../../api/stats";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import type { Team } from "../../types/team";
import type { TeamStats } from "../../types/stats";
import styles from "./dashboard.module.css";
import teamStyles from "../teams/teams.module.css";

const COACH_STAFF_ROLES = new Set<string>(["head_coach", "assistant_coach"]);

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; teams: Team[]; events: CalendarEvent[] };

type StatsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: TeamStats };

export function CoachDashboard({
  token,
  onOpenEvent,
  onOpenTeam,
}: {
  token: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [statsState, setStatsState] = useState<StatsState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([listMyTeams(token), getCalendar(token, isoDatePlusDays(-7), isoDatePlusDays(14))])
      .then(([teams, events]) => {
        const coachTeams = teams.filter((t) => t.myRole && COACH_STAFF_ROLES.has(t.myRole));
        if (coachTeams.length === 0) {
          setState({ status: "empty" });
          return;
        }
        setState({ status: "ready", teams: coachTeams, events });
        setSelectedTeamId((current) => current ?? coachTeams[0].id);
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить данные";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!selectedTeamId) return;
    setStatsState({ status: "loading" });
    getTeamStats(token, selectedTeamId)
      .then((stats) => setStatsState({ status: "ready", stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить статистику";
        setStatsState({ status: "error", message });
      });
  }, [token, selectedTeamId]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить главную" description={state.message} onRetry={load} />;
  }
  if (state.status === "empty") {
    return (
      <StateScreen
        kind="empty"
        title="Пока нет команд"
        description="Создайте команду на вкладке «Команды», чтобы видеть здесь тренировки, нагрузку и задачи."
      />
    );
  }

  const { teams, events } = state;
  const today = isoDatePlusDays(0);
  const nextEvent = events.find((e) => e.date >= today);
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? teams[0];

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Тренерская панель</h1>
      </div>

      {nextEvent ? (
        <button type="button" className={styles.nextEventCard} onClick={() => onOpenEvent(nextEvent)}>
          <Icon name={CALENDAR_EVENT_ICONS[nextEvent.type]} size={22} />
          <div className={styles.nextEventText}>
            <span className={styles.nextEventLabel}>Ближайшее</span>
            <span className={styles.nextEventTitle}>{nextEvent.title}</span>
            <span className={styles.nextEventMeta}>
              {nextEvent.date}
              {nextEvent.time ? ` · ${nextEvent.time}` : ""}
              {nextEvent.teamName ? ` · ${nextEvent.teamName}` : ""}
            </span>
          </div>
          <Icon name="chevron-right" size={18} />
        </button>
      ) : (
        <p className={styles.emptyHint}>Ближайших событий нет.</p>
      )}

      {teams.length > 1 && (
        <div className={styles.teamSwitcher}>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className={team.id === selectedTeamId ? styles.chipActive : styles.chip}
              onClick={() => setSelectedTeamId(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {statsState.status === "ready" && (
        <div className={styles.kpiRow}>
          <StatTile value={`${statsState.stats.attendanceRate ?? 0}%`} label="Посещаемость" tone="dark" />
          <StatTile value={statsState.stats.trainingsUpcoming} label="Тренировок впереди" />
          <StatTile value={statsState.stats.tasksOverdue} label="Просрочено заданий" />
          <StatTile
            value={`${statsState.stats.matchesWon}-${statsState.stats.matchesLost}-${statsState.stats.matchesDrawn}`}
            label="П-Пор-Н"
          />
        </div>
      )}
      {statsState.status === "loading" && <p className={styles.emptyHint}>Загрузка статистики…</p>}
      {statsState.status === "error" && <p className={styles.emptyHint}>{statsState.message}</p>}

      <button type="button" className={teamStyles.navRow} onClick={() => onOpenTeam(selectedTeam.id)}>
        <span className={teamStyles.navRowIcon}>
          <Icon name="trophy" size={18} />
        </span>
        <span className={teamStyles.navRowLabel}>Открыть «{selectedTeam.name}»</span>
        <span className={teamStyles.navRowChevron}>
          <Icon name="chevron-right" size={18} />
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/dashboard.module.css frontend/src/components/dashboard/CoachDashboard.tsx
git commit -m "MBA redesign: add CoachDashboard"
```

---

### Task 8: `PlayerDashboard`

**Files:**
- Create: `frontend/src/components/dashboard/PlayerDashboard.tsx`

**Interfaces:**
- Consumes: `getCalendar` (`frontend/src/api/calendar.ts`), `getPlayerStats` (`frontend/src/api/stats.ts`), `PlayerStats` (`frontend/src/types/stats.ts`), `dashboard.module.css` from Task 7 (same classes, no new ones).
- Produces: `PlayerDashboard({ token, userId, onOpenEvent, onCreateTraining, onOpenMyStats }: { token: string; userId: string; onOpenEvent: (event: CalendarEvent) => void; onCreateTraining: () => void; onOpenMyStats: () => void })`. Consumed by Task 9 (`DashboardScreen`).

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/dashboard/PlayerDashboard.tsx
import { useCallback, useEffect, useState } from "react";
import { getCalendar } from "../../api/calendar";
import { getPlayerStats } from "../../api/stats";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import { StatTile } from "../shared/StatTile";
import { CALENDAR_EVENT_ICONS, type CalendarEvent } from "../../types/calendar";
import type { PlayerStats } from "../../types/stats";
import styles from "./dashboard.module.css";

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; events: CalendarEvent[]; stats: PlayerStats };

export function PlayerDashboard({
  token,
  userId,
  onOpenEvent,
  onCreateTraining,
  onOpenMyStats,
}: {
  token: string;
  userId: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreateTraining: () => void;
  onOpenMyStats: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([getCalendar(token, isoDatePlusDays(-7), isoDatePlusDays(14)), getPlayerStats(token, userId)])
      .then(([events, stats]) => setState({ status: "ready", events, stats }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить данные";
        setState({ status: "error", message });
      });
  }, [token, userId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить главную" description={state.message} onRetry={load} />;
  }

  const { events, stats } = state;
  const today = isoDatePlusDays(0);
  const nextEvent = events.find((e) => e.date >= today);

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <Ornament tone="primary" intensity="subtle" />
        <p className={styles.heroLabel}>Главная</p>
        <h1 className={styles.heroTitle}>Твой прогресс</h1>
      </div>

      {nextEvent ? (
        <button type="button" className={styles.nextEventCard} onClick={() => onOpenEvent(nextEvent)}>
          <Icon name={CALENDAR_EVENT_ICONS[nextEvent.type]} size={22} />
          <div className={styles.nextEventText}>
            <span className={styles.nextEventLabel}>Ближайшее</span>
            <span className={styles.nextEventTitle}>{nextEvent.title}</span>
            <span className={styles.nextEventMeta}>
              {nextEvent.date}
              {nextEvent.time ? ` · ${nextEvent.time}` : ""}
              {nextEvent.teamName ? ` · ${nextEvent.teamName}` : ""}
            </span>
          </div>
          <Icon name="chevron-right" size={18} />
        </button>
      ) : (
        <p className={styles.emptyHint}>Ближайших событий нет.</p>
      )}

      <div className={styles.kpiRow}>
        <StatTile value={`${stats.attendanceRate ?? 0}%`} label="Посещаемость" tone="dark" />
        <StatTile value={stats.activityStreak} label="Серия посещений" />
        <StatTile value={stats.tasksCompleted} label="Заданий выполнено" />
        <StatTile value={stats.tasksOverdue} label="Просрочено" />
      </div>

      <button type="button" className={styles.recommendationCard} onClick={onOpenMyStats}>
        <Icon name="sparkles" size={20} />
        <div className={styles.nextEventText}>
          <span className={styles.nextEventTitle}>Рекомендации ИИ</span>
          <span className={styles.nextEventMeta}>Разбор прогресса и советы по нагрузке</span>
        </div>
        <Icon name="chevron-right" size={18} />
      </button>

      <button type="button" className={styles.quickAction} onClick={onCreateTraining}>
        <Icon name="plus" size={16} />
        Добавить тренировку
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/PlayerDashboard.tsx
git commit -m "MBA redesign: add PlayerDashboard"
```

---

### Task 9: `DashboardScreen` role router

**Files:**
- Create: `frontend/src/components/dashboard/DashboardScreen.tsx`

**Interfaces:**
- Consumes: `useProfile()` (`frontend/src/context/ProfileContext.tsx`), `CoachDashboard` (Task 7), `PlayerDashboard` (Task 8), `StateScreen`.
- Produces: `DashboardScreen({ token, userId, onOpenEvent, onOpenTeam, onCreateTraining, onOpenMyStats })`. Consumed by Task 10 (`Workspace.tsx`).

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/dashboard/DashboardScreen.tsx
import { useProfile } from "../../context/ProfileContext";
import { StateScreen } from "../StateScreen";
import { CoachDashboard } from "./CoachDashboard";
import { PlayerDashboard } from "./PlayerDashboard";
import type { CalendarEvent } from "../../types/calendar";

interface DashboardScreenProps {
  token: string;
  userId: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
  onOpenMyStats: () => void;
}

/** Landing tab ("Главная") for both roles — routes to CoachDashboard or
 * PlayerDashboard based on the active profile mode. See
 * docs/superpowers/specs/2026-08-17-mba-redesign-design.md, "Dashboard". */
export function DashboardScreen({
  token,
  userId,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
  onOpenMyStats,
}: DashboardScreenProps) {
  const { state } = useProfile();

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} />;
  }

  if (state.data.activeMode === "coach") {
    return <CoachDashboard token={token} onOpenEvent={onOpenEvent} onOpenTeam={onOpenTeam} />;
  }

  return (
    <PlayerDashboard
      token={token}
      userId={userId}
      onOpenEvent={onOpenEvent}
      onCreateTraining={onCreateTraining}
      onOpenMyStats={onOpenMyStats}
    />
  );
}
```

- [ ] **Step 2: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/DashboardScreen.tsx
git commit -m "MBA redesign: add DashboardScreen role router"
```

---

### Task 10: Wire Dashboard into `Workspace.tsx` as the landing tab

**Files:**
- Modify: `frontend/src/Workspace.tsx` (imports; `CoachTab`/`PlayerTab` types; `COACH_NAV_ITEMS`/`PLAYER_NAV_ITEMS`; `CoachTabContent`; the player-tab render block; the two `useState` defaults)

**Interfaces:**
- Consumes: `DashboardScreen` (Task 9), existing `calendarEventToOverlay` (already defined in `Workspace.tsx`), existing overlay-setting callbacks already used by `MyTeamsScreen`/`CalendarScreen`/`ProfileScreen` in the same file.

- [ ] **Step 1: Add the import**

Near the top of `frontend/src/Workspace.tsx`, add, alongside the other component imports (e.g. right after the `ProfileScreen` import line):

```tsx
import { DashboardScreen } from "./components/dashboard/DashboardScreen";
```

- [ ] **Step 2: Add `"dashboard"` to both tab types**

Replace:

```tsx
type CoachTab = "teams" | "library" | "calendar" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why.
type PlayerTab = "teams" | "calendar" | "profile";
```

with:

```tsx
type CoachTab = "dashboard" | "teams" | "library" | "calendar" | "profile";
// "Тренировки" was merged into "Календарь" and "Задания" now only lives
// inside each team screen — see the "Доработки после итерации 15" README
// section for why. "Главная" (dashboard) was added in the MBA redesign,
// see docs/superpowers/specs/2026-08-17-mba-redesign-design.md.
type PlayerTab = "dashboard" | "teams" | "calendar" | "profile";
```

- [ ] **Step 3: Add "Главная" as the first nav item for both roles**

Replace:

```tsx
const COACH_NAV_ITEMS: NavItem<CoachTab>[] = [
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "library", label: "Библиотека", icon: "book" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab>[] = [
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
];
```

with:

```tsx
const COACH_NAV_ITEMS: NavItem<CoachTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "library", label: "Библиотека", icon: "book" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
];

const PLAYER_NAV_ITEMS: NavItem<PlayerTab>[] = [
  { key: "dashboard", label: "Главная", icon: "home" },
  { key: "teams", label: "Команды", icon: "trophy" },
  { key: "calendar", label: "Календарь", icon: "calendar" },
  { key: "profile", label: "Профиль", icon: "user" },
];
```

- [ ] **Step 4: Extend `CoachTabContent` with the callbacks Dashboard needs**

Replace:

```tsx
function CoachTabContent({ tab, token, onOpenMyStats }: { tab: CoachTab; token: string; onOpenMyStats: () => void }) {
  switch (tab) {
    case "teams":
      return <TeamsScreen token={token} />;
    case "library":
      return <LibraryScreen token={token} />;
    case "calendar":
      return <CalendarScreen token={token} />;
    case "profile":
      return <ProfileScreen token={token} onOpenMyStats={onOpenMyStats} />;
  }
}
```

with:

```tsx
function CoachTabContent({
  tab,
  token,
  userId,
  onOpenMyStats,
  onOpenEvent,
  onOpenTeam,
  onCreateTraining,
}: {
  tab: CoachTab;
  token: string;
  userId: string;
  onOpenMyStats: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTeam: (teamId: string) => void;
  onCreateTraining: () => void;
}) {
  switch (tab) {
    case "dashboard":
      return (
        <DashboardScreen
          token={token}
          userId={userId}
          onOpenEvent={onOpenEvent}
          onOpenTeam={onOpenTeam}
          onCreateTraining={onCreateTraining}
          onOpenMyStats={onOpenMyStats}
        />
      );
    case "teams":
      return <TeamsScreen token={token} />;
    case "library":
      return <LibraryScreen token={token} />;
    case "calendar":
      return <CalendarScreen token={token} />;
    case "profile":
      return <ProfileScreen token={token} onOpenMyStats={onOpenMyStats} />;
  }
}
```

- [ ] **Step 5: Update the coach and player render blocks**

Replace:

```tsx
  if (state.status === "ready" && state.data.activeMode === "coach") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <CoachTabContent tab={coachTab} token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />
        </div>
        <BottomNav items={COACH_NAV_ITEMS} active={coachTab} onChange={setCoachTab} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {playerTab === "teams" && <MyTeamsScreen token={token} onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })} />}
        {playerTab === "calendar" && (
          <CalendarScreen
            token={token}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
          />
        )}
        {playerTab === "profile" && <ProfileScreen token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />}
      </div>
      <BottomNav items={PLAYER_NAV_ITEMS} active={playerTab} onChange={setPlayerTab} />
    </div>
  );
```

with:

```tsx
  if (state.status === "ready" && state.data.activeMode === "coach") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <CoachTabContent
            tab={coachTab}
            token={token}
            userId={myUserId ?? ""}
            onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
          />
        </div>
        <BottomNav items={COACH_NAV_ITEMS} active={coachTab} onChange={setCoachTab} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {playerTab === "dashboard" && myUserId && (
          <DashboardScreen
            token={token}
            userId={myUserId}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
            onOpenMyStats={() => setOverlay({ kind: "my-stats" })}
          />
        )}
        {playerTab === "teams" && <MyTeamsScreen token={token} onOpenTeam={(teamId) => setOverlay({ kind: "team", teamId })} />}
        {playerTab === "calendar" && (
          <CalendarScreen
            token={token}
            onOpenEvent={(event) => setOverlay(calendarEventToOverlay(event))}
            onCreateTraining={() => setOverlay({ kind: "training-create" })}
          />
        )}
        {playerTab === "profile" && <ProfileScreen token={token} onOpenMyStats={() => setOverlay({ kind: "my-stats" })} />}
      </div>
      <BottomNav items={PLAYER_NAV_ITEMS} active={playerTab} onChange={setPlayerTab} />
    </div>
  );
```

(`myUserId` and `calendarEventToOverlay` already exist earlier in this file — `myUserId` is computed at the top of `MainContent` from `authState`, `calendarEventToOverlay` is the existing top-level helper already used by the player calendar branch.)

- [ ] **Step 6: Change the landing-tab defaults**

Replace:

```tsx
  const [coachTab, setCoachTab] = useState<CoachTab>("teams");
  const [playerTab, setPlayerTab] = useState<PlayerTab>("profile");
```

with:

```tsx
  const [coachTab, setCoachTab] = useState<CoachTab>("dashboard");
  const [playerTab, setPlayerTab] = useState<PlayerTab>("dashboard");
```

- [ ] **Step 7: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0. (A prop mismatch between `CoachTabContent`'s new signature and its call site, or a missing `CalendarEvent` import, would fail here.)

- [ ] **Step 8: Manual check**

Open `http://localhost:5175`. After onboarding (dev-login creates a fresh user with no profile yet — pick either role), confirm:
- Bottom nav's first item is "Главная" with the home icon, and it's active on load.
- The Dashboard hero card renders with the dark graphite background and a faint diagonal wave-stripe pattern.
- With zero teams, the empty state ("Пока нет команд" for coach, or the player's calendar-driven view) renders without a crash.
- Tapping "Команды" and back to "Главная" doesn't lose state or error.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/Workspace.tsx
git commit -m "MBA redesign: wire DashboardScreen as the landing nav tab"
```

---

### Task 11: Update `MASTER.md`

**Files:**
- Modify: `frontend/design-system/teamflow-sports/MASTER.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Append a new dated section**

Add a new section at the end of the file (after the existing "Компоненты, которые меняются централизованно" section):

```markdown

## MBA-редизайн (2026-08-17, Phase 1 — ядро + Dashboard)

Полная замена палитры и точечная правка формы под айдентику баскетбольного
клуба МБА — см. `docs/superpowers/specs/2026-08-17-mba-redesign-design.md`
для полного обоснования. Итог Phase 1:

- **Тема**: светлая стала основной (было — тёмная); тёмная осталась
  полноценной вторичной темой, не заглушкой. Переключение по-прежнему в
  `ThemeContext.tsx` / кнопка в профиле.
- **Цвет**: `--color-primary` — MBA Red (`#D91E2B` светлая / `#FF3B3F`
  тёмная), `--color-accent-blue` перекрашен в коралловый (был тил/бирюза;
  имя переменной сохранено, чтобы не трогать 4 файла, где он используется).
  `--color-danger` теперь оранжево-красный, отдельный от бренда, чтобы не
  путать ошибки с акцентом. `--color-primary-glow` теперь светло-розовая
  заливка (была синим свечением) — имя тоже сохранено (5 мест использования
  не тронуты).
- **Форма**: радиусы уменьшены (`--radius-lg` 14→12px, `--radius-md`
  10→8px, `--radius-sm` 6→4px) — более чёткая геометрия, pill остался
  только у бейджей/переключателей.
- **Типографика**: `.heading`/`.pageHeading` выросли с 24px до 28px;
  `.statValue` и новый `StatTile` получили `tabular-nums`.
- **Новые shared-примитивы**: `components/shared/Ornament.tsx`
  (волнообразные полосы, параметры `tone`/`intensity` — используется только
  в hero-блоках, никогда за плотными данными) и
  `components/shared/StatTile.tsx` (крупная KPI-цифра 40px, отдельно от
  существующего мелкого `.statGrid`/`.statValue` в `teams.module.css` —
  оба паттерна остаются, не путать роли).
- **Новый экран**: `components/dashboard/` (`DashboardScreen` — роутер по
  `activeMode`, `CoachDashboard`, `PlayerDashboard`) — первая вкладка
  «Главная» у обеих ролей, собрана из уже существующих
  `GET /api/calendar`, `GET /api/teams/{id}/stats`,
  `GET /api/players/{id}/stats` — без изменений backend.
```

- [ ] **Step 2: Commit**

```bash
git add frontend/design-system/teamflow-sports/MASTER.md
git commit -m "MBA redesign: document Phase 1 in MASTER.md"
```

---

### Task 12: Full manual verification pass (Phase 1 gate)

**Files:** None — verification only, no code changes.

- [ ] **Step 1: Confirm the dev stack is up**

Run: `docker compose -f docker-compose.dev.yml ps`
Expected: `postgres`, `backend`, `frontend` all `Up`/`healthy`. If not, run `docker compose -f docker-compose.dev.yml up -d backend frontend` (see `docs/dev-notes.md`).

- [ ] **Step 2: Full lint + build pass**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 3: Backend regression check**

Run: `docker compose -f docker-compose.dev.yml exec backend python -m pytest -q`
Expected: all tests pass (this phase touches zero backend files, so this should be unaffected — run it anyway as a safety net for accidental cross-contamination).

- [ ] **Step 4: Visual walkthrough checklist**

Open `http://localhost:5175` and confirm each of the following (all from `docs/superpowers/specs/2026-08-17-mba-redesign-design.md`):

- [ ] Default theme on first load (no `tf-theme` in localStorage — use a private/incognito window) is light, near-white background, not dark navy.
- [ ] Primary buttons, active nav item, active tab underline are all MBA Red, not the old blue.
- [ ] Theme toggle in Профиль switches to the dark theme (graphite `#121214`-family background, brighter red accent) and back.
- [ ] "Главная" is the first bottom-nav item for both a coach-mode and a player-mode test account, and is selected by default on load.
- [ ] Dashboard hero card is dark-graphite with a faint diagonal-stripe pattern visible but not overpowering the text.
- [ ] KPI numbers on the Dashboard (once a test account has at least one team with data) render large, bold, and don't shift width when the value changes (tabular-nums).
- [ ] Empty state (no teams) shows the existing illustration-based empty screen, not a raw error or a KPI grid full of zeros.
- [ ] `.heading`/page titles across a few existing screens (Команды, a form title in Библиотека) are visibly larger than before.
- [ ] Nothing on the calendar/tasks screens (which use `--color-accent-blue` for "match"/"submitted" markers) looks broken — those should now read as coral instead of teal, not as an error state.

- [ ] **Step 5: Report status**

If every item above passes, Phase 1 is ready for the user's live review — do not start Phase 2 (team hub restructure) until they confirm. If any item fails, fix it as a follow-up commit on top of this plan's tasks before declaring Phase 1 done.
