# MBA Redesign — Phase 2 (Team Screen Hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `TeamDetailScreen`'s horizontal tab bar (Обзор/Тренировки/Задания/Матчи, with Состав/Статистика/Настройки only reachable via nested nav-rows inside Обзор) with a single hub screen — Обзор becomes the team's home, showing a grid of large tappable tiles for all six sections. No tabs remain; every section is one tap from the hub, and every section's back button returns to the hub.

**Architecture:** Pure restructuring of one existing screen's entry points. The six section bodies (roster list, `TeamTrainingsTab`, `TeamTasksTab`, `TeamMatchesTab`, `TeamStatsTab`, settings block) are unchanged — only how the user reaches them changes. Two new CSS classes-groups are added to the existing shared `teams.module.css` (already the file every team-related screen imports); nothing is removed from it, since `.tabs`/`.tab`/`.tabActive` are still used by Library/Stats screens and `.navRow`/`.navRowIcon`/`.navRowLabel`/`.navRowChevron` are still used by `CoachDashboard` (Phase 1). No backend changes.

**Tech Stack:** React 19 + TypeScript, CSS Modules — same as Phase 1.

## Global Constraints

- No backend/database changes anywhere in this plan.
- No new npm dependencies.
- Do not remove or modify any existing CSS rule in `teams.module.css` — only add new ones. `.tabs`/`.tab`/`.tabActive` (used by Library/Stats) and `.navRow`/`.navRowIcon`/`.navRowLabel`/`.navRowChevron` (used by `CoachDashboard`, added in Phase 1) must keep working exactly as before for their other call sites.
- The six section bodies (roster rendering, `TeamTrainingsTab`, `TeamTasksTab`, `TeamMatchesTab`, `TeamStatsTab`, the settings block) must render identically to today — this plan changes navigation only, not their content or the permission checks around them (`isCoachStaff`, `isCaptain`, `canSeeSettingsTab`).
- Dev stack for manual verification: `docker-compose.dev.yml` already running, frontend at `http://localhost:5175`, backend at `http://localhost:8002`. Run `npm` commands via `docker compose -f docker-compose.dev.yml exec frontend <cmd>`.

---

### Task 1: Hub tile CSS classes

**Files:**
- Modify: `frontend/src/components/teams/teams.module.css` (append only, end of file)

**Interfaces:**
- Produces: `.hubGrid`, `.hubTile`, `.hubTileTop`, `.hubTileIcon`, `.hubTileTitle`, `.hubTileSubtitle` — new classes. Reuses the existing `.chevron` class (already defined earlier in the same file) for the tile's corner arrow. Consumed by Task 2.

- [ ] **Step 1: Append the new classes to the end of `teams.module.css`**

Add this block after the file's last existing rule (`.inviteExpiry`):

```css

.hubGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.hubTile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  width: 100%;
  transition: border-color var(--transition-fast), transform var(--transition-fast);
}

.hubTile:active {
  transform: scale(0.98);
  border-color: var(--color-border-strong);
}

.hubTileTop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.hubTileIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary-glow);
  color: var(--color-primary);
}

.hubTileTitle {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
}

.hubTileSubtitle {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.3;
}
```

- [ ] **Step 2: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0. (Nothing consumes these classes yet — Task 2 wires them up. This step only confirms the CSS module still parses.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teams/teams.module.css
git commit -m "MBA redesign Phase 2: add team-hub tile CSS classes"
```

---

### Task 2: Replace TeamDetailScreen's tab bar with the hub

**Files:**
- Modify: `frontend/src/components/teams/TeamDetailScreen.tsx:109-224` (header, tab bar, and the overview section's nav-row card)

**Interfaces:**
- Consumes: `.hubGrid`/`.hubTile`/`.hubTileTop`/`.hubTileIcon`/`.hubTileTitle`/`.hubTileSubtitle` from Task 1, plus the already-imported `.chevron` class and `Icon` component.
- No new props, no new exported interfaces — this task only changes JSX inside the existing `TeamDetailScreen` component. The `Tab` type (`"overview" | "roster" | "trainings" | "tasks" | "matches" | "stats" | "settings"`), `tab`/`setTab` state, and every section body below line 224 in the current file (roster list, `TeamTrainingsTab`, `TeamTasksTab`, `TeamMatchesTab`, `TeamStatsTab`, settings block, and all three modals) are unchanged — do not touch them.

- [ ] **Step 1: Make the header's back button context-aware and remove the tab bar**

Replace:

```tsx
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={styles.tabs}>
        <button type="button" className={tab === "overview" ? styles.tabActive : styles.tab} onClick={() => setTab("overview")}>
          Обзор
        </button>
        <button type="button" className={tab === "trainings" ? styles.tabActive : styles.tab} onClick={() => setTab("trainings")}>
          Тренировки
        </button>
        <button type="button" className={tab === "tasks" ? styles.tabActive : styles.tab} onClick={() => setTab("tasks")}>
          Задания
        </button>
        <button type="button" className={tab === "matches" ? styles.tabActive : styles.tab} onClick={() => setTab("matches")}>
          Матчи
        </button>
      </div>
```

with:

```tsx
      <div className={styles.headerRow}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => (tab === "overview" ? onBack() : setTab("overview"))}
        >
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>
```

(This single button now serves both roles: on the hub itself, "Назад" exits to the teams list via `onBack`, exactly as before; on any section opened from the hub, "Назад" returns to the hub — the plan's single-level-navigation rule. No other screen's "Назад" behavior changes.)

- [ ] **Step 2: Replace the nav-row card with the hub tile grid**

Replace:

```tsx
          <div className={profileStyles.card}>
            <button type="button" className={styles.navRow} onClick={() => setTab("roster")}>
              <span className={styles.navRowIcon}>
                <Icon name="users" size={17} />
              </span>
              <span className={styles.navRowLabel}>Состав</span>
              <span className={styles.navRowChevron}>
                <Icon name="chevron-right" size={17} />
              </span>
            </button>
            {isCoachStaff && (
              <button type="button" className={styles.navRow} onClick={() => setTab("stats")}>
                <span className={styles.navRowIcon}>
                  <Icon name="award" size={17} />
                </span>
                <span className={styles.navRowLabel}>Статистика</span>
                <span className={styles.navRowChevron}>
                  <Icon name="chevron-right" size={17} />
                </span>
              </button>
            )}
            {canSeeSettingsTab && (
              <button type="button" className={styles.navRow} onClick={() => setTab("settings")}>
                <span className={styles.navRowIcon}>
                  <Icon name="settings" size={17} />
                </span>
                <span className={styles.navRowLabel}>Настройки</span>
                <span className={styles.navRowChevron}>
                  <Icon name="chevron-right" size={17} />
                </span>
              </button>
            )}
          </div>
```

with:

```tsx
          <div className={styles.hubGrid}>
            <button type="button" className={styles.hubTile} onClick={() => setTab("roster")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="users" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Состав</span>
              <span className={styles.hubTileSubtitle}>{members.length} участников</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("trainings")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="dumbbell" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Тренировки</span>
              <span className={styles.hubTileSubtitle}>Расписание команды</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("tasks")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="clipboard" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Задания</span>
              <span className={styles.hubTileSubtitle}>Задания игрокам</span>
            </button>

            <button type="button" className={styles.hubTile} onClick={() => setTab("matches")}>
              <div className={styles.hubTileTop}>
                <span className={styles.hubTileIcon}>
                  <Icon name="ball" size={20} />
                </span>
                <span className={styles.chevron}>
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
              <span className={styles.hubTileTitle}>Матчи</span>
              <span className={styles.hubTileSubtitle}>Составы и результаты</span>
            </button>

            {isCoachStaff && (
              <button type="button" className={styles.hubTile} onClick={() => setTab("stats")}>
                <div className={styles.hubTileTop}>
                  <span className={styles.hubTileIcon}>
                    <Icon name="award" size={20} />
                  </span>
                  <span className={styles.chevron}>
                    <Icon name="chevron-right" size={16} />
                  </span>
                </div>
                <span className={styles.hubTileTitle}>Статистика</span>
                <span className={styles.hubTileSubtitle}>Показатели команды</span>
              </button>
            )}

            {canSeeSettingsTab && (
              <button type="button" className={styles.hubTile} onClick={() => setTab("settings")}>
                <div className={styles.hubTileTop}>
                  <span className={styles.hubTileIcon}>
                    <Icon name="settings" size={20} />
                  </span>
                  <span className={styles.chevron}>
                    <Icon name="chevron-right" size={16} />
                  </span>
                </div>
                <span className={styles.hubTileTitle}>Настройки</span>
                <span className={styles.hubTileSubtitle}>Лого, приглашения, заявки</span>
              </button>
            )}
          </div>
```

Note: the tile subtitles are short static descriptions, not live counts (e.g. not "3 тренировки на неделе") — showing a real count would require new data fetching (trainings/tasks/matches lists, none of which `TeamDetailScreen` currently loads) which is out of scope for a navigation restructure. This is a deliberate, disclosed simplification — do not add new API calls to populate these subtitles.

- [ ] **Step 3: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual check**

Open `http://localhost:5175`, sign in as (or dev-login as) a coach with at least one team, open a team. Confirm:
- No horizontal tab bar is visible; Обзор shows the team info card followed by a 2-column grid of tiles (Состав, Тренировки, Задания, Матчи, Статистика, Настройки — Статистика/Настройки only for coach staff, matching the same visibility rules as before).
- Tapping each tile opens the same content that used to live behind that tab/nav-row (roster list, trainings list, tasks list, matches list, stats, settings).
- From any of those, tapping «← Назад» returns to the hub (Обзор), not to the teams list.
- From the hub itself, tapping «← Назад» exits to the teams list, exactly as before.
- The "Передать роль основного тренера" / "Покинуть команду" card at the bottom of Обзор is unaffected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/teams/TeamDetailScreen.tsx
git commit -m "MBA redesign Phase 2: team screen becomes a tile hub, tabs removed"
```

---

### Task 3: Verification pass

**Files:** None — verification only, no code changes.

- [ ] **Step 1: Full lint + build pass**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 2: Backend regression check**

Run: `docker compose -f docker-compose.dev.yml exec backend python -m pytest -q`
Expected: all tests pass (this plan touches zero backend files; this is a safety net, not an expected-to-fail check).

- [ ] **Step 3: Cross-check the two other consumers of the shared classes this plan did not touch**

Confirm neither was affected by Task 1's additions (pure append) or Task 2's changes (scoped to `TeamDetailScreen.tsx` only):
- Open a screen that uses `.tabs`/`.tab`/`.tabActive` (e.g. Библиотека → Упражнения/Планы/Шаблоны tabs, or Статистика team/player toggle) — confirm it still renders and switches tabs normally.
- Open Главная (Dashboard) as a coach with a team — confirm the "Открыть «<team name>»" row (built on `.navRow` in `CoachDashboard.tsx`, Phase 1) still renders and navigates correctly.

- [ ] **Step 4: Visual walkthrough checklist**

Open `http://localhost:5175` and confirm, for both a coach and a player account with at least one team:
- [ ] Team hub grid renders with correct tile visibility per role (player sees only Состав/Тренировки/Задания/Матчи; coach staff additionally sees Статистика; settings visibility follows the existing `canSeeSettingsTab` rule).
- [ ] Every tile navigates to working content, and every section's back button returns to the hub, not further back.
- [ ] No leftover horizontal tab bar anywhere on the team screen.
- [ ] Tiles look reasonably balanced in a 2-column grid at a typical phone width (360-414px) — no obvious text overflow in `.hubTileSubtitle`.

- [ ] **Step 5: Report status**

If every item above passes, Phase 2 is ready for the user's live review. If any item fails, fix it as a follow-up commit on top of this plan's tasks before declaring Phase 2 done.
