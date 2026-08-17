# MBA Redesign — Phase 3 (Form Sectioning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the optional/secondary fields in the three creation forms flagged as overloaded (`TrainingForm`, `TaskForm`, `PlanForm`) into collapsed-by-default sections, so a first-time user sees only what the current scenario needs, per the design spec's "Layout / IA" point 1.

**Architecture:** One new shared component, `CollapsibleSection` (a labeled toggle button + conditionally-rendered body, local `useState` for open/closed), applied by wrapping existing JSX blocks in place — no field is moved relative to its neighbors, no state/handler/validation logic changes in any form. Required fields (title, date/time, "кому назначить" for tasks) stay unconditionally visible; only genuinely optional groups get wrapped.

**Tech Stack:** React 19 + TypeScript, CSS Modules — same as Phases 1-2.

## Global Constraints

- No backend/database changes anywhere in this plan.
- No new npm dependencies.
- No field moves relative to its current neighbors — sections wrap existing, already-contiguous JSX blocks in place. No form's submit handler, validation, or state shape changes.
- A section defaults to **open** (`defaultOpen={isEdit}`) whenever the form is in edit mode and the section could contain an already-set value, so editing an existing record never hides its own current values behind a collapsed toggle. A section defaults to **closed** when the form is creating a new record, or when the section only ever renders in create mode anyway.
- Required fields for the form's core scenario (title/name, date/time, duration, and — for tasks — "Кому назначить") are never wrapped in a `CollapsibleSection`.
- Dev stack for manual verification: `docker-compose.dev.yml` already running, frontend at `http://localhost:5175`, backend at `http://localhost:8002`. Run `npm` commands via `docker compose -f docker-compose.dev.yml exec frontend <cmd>`.

---

### Task 1: `CollapsibleSection` shared component

**Files:**
- Create: `frontend/src/components/shared/CollapsibleSection.tsx`
- Create: `frontend/src/components/shared/CollapsibleSection.module.css`

**Interfaces:**
- Produces: `CollapsibleSection({ label: string; defaultOpen?: boolean; children: ReactNode })`. Consumed by Task 2 (`TrainingForm`), Task 3 (`TaskForm`), Task 4 (`PlanForm`).

- [ ] **Step 1: Create the CSS module**

```css
/* frontend/src/components/shared/CollapsibleSection.module.css */
.section {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 14px;
  background: var(--color-surface-alt);
  border: none;
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  text-align: left;
}

.toggleLabel {
  flex: 1;
}

.chevron {
  display: flex;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  transition: transform var(--transition-fast);
}

.chevronOpen {
  transform: rotate(90deg);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
}
```

- [ ] **Step 2: Create the component**

```tsx
// frontend/src/components/shared/CollapsibleSection.tsx
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
```

- [ ] **Step 3: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0. (Nothing imports this yet — Tasks 2-4 wire it up.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/CollapsibleSection.tsx frontend/src/components/shared/CollapsibleSection.module.css
git commit -m "MBA redesign Phase 3: add CollapsibleSection shared component"
```

---

### Task 2: Section `TrainingForm`

**Files:**
- Modify: `frontend/src/components/trainings/TrainingForm.tsx`

**Interfaces:**
- Consumes: `CollapsibleSection` from Task 1.
- No new props, no new exported interfaces — every field's `useState`, every handler, and the full submit logic stay exactly as they are. Only three existing JSX blocks get wrapped, in place.

- [ ] **Step 1: Add the import**

Add, alongside the other component imports near the top of the file:

```tsx
import { CollapsibleSection } from "../shared/CollapsibleSection";
```

- [ ] **Step 2: Wrap the team-only plan/independent-training block**

Replace:

```tsx
        {mode === "team" && (
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>План тренировки</span>
            <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Без плана</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "team" && (
          <>
            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={isIndependent} onChange={(e) => setIsIndependent(e.target.checked)} />
              <span className={profileStyles.label}>Самостоятельная тренировка (без тренера)</span>
            </label>

            {isIndependent && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Ответственный игрок</span>
                <select className={profileStyles.select} value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
                  <option value="">По умолчанию — капитан</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.firstName} {m.lastName ?? ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
```

with:

```tsx
        {mode === "team" && (
          <CollapsibleSection label="Настройки команды" defaultOpen={isEdit}>
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>План тренировки</span>
              <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Без плана</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={isIndependent} onChange={(e) => setIsIndependent(e.target.checked)} />
              <span className={profileStyles.label}>Самостоятельная тренировка (без тренера)</span>
            </label>

            {isIndependent && (
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Ответственный игрок</span>
                <select className={profileStyles.select} value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
                  <option value="">По умолчанию — капитан</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.firstName} {m.lastName ?? ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </CollapsibleSection>
        )}
```

- [ ] **Step 3: Wrap the reminder field**

Replace:

```tsx
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Напомнить за, мин</span>
          <input
            className={profileStyles.input}
            type="number"
            min={0}
            max={10080}
            value={reminderMinutesBefore}
            onChange={(e) => setReminderMinutesBefore(e.target.value)}
          />
        </label>
```

with:

```tsx
        <CollapsibleSection label="Напоминание" defaultOpen={isEdit}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Напомнить за, мин</span>
            <input
              className={profileStyles.input}
              type="number"
              min={0}
              max={10080}
              value={reminderMinutesBefore}
              onChange={(e) => setReminderMinutesBefore(e.target.value)}
            />
          </label>
        </CollapsibleSection>
```

- [ ] **Step 4: Wrap the weekly-repeat block**

Replace:

```tsx
        {!isEdit && (
          <>
            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
              <span className={profileStyles.label}>Применять для каждой недели</span>
            </label>

            {repeatWeekly && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Повторять</span>
                {(
                  [
                    { key: "1m", label: "1 месяц" },
                    { key: "6m", label: "Полгода" },
                    { key: "12m", label: "Год" },
                    { key: "custom", label: "Указать количество месяцев" },
                  ] as const
                ).map((opt) => (
                  <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <input type="radio" name="recurrencePreset" checked={recurrencePreset === opt.key} onChange={() => setRecurrencePreset(opt.key)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
                {recurrencePreset === "custom" && (
                  <input
                    className={profileStyles.input}
                    type="number"
                    min={1}
                    max={24}
                    value={customMonths}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                )}
              </div>
            )}
          </>
        )}
```

with:

```tsx
        {!isEdit && (
          <CollapsibleSection label="Повторение">
            <label className={profileStyles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
              <span className={profileStyles.label}>Применять для каждой недели</span>
            </label>

            {repeatWeekly && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Повторять</span>
                {(
                  [
                    { key: "1m", label: "1 месяц" },
                    { key: "6m", label: "Полгода" },
                    { key: "12m", label: "Год" },
                    { key: "custom", label: "Указать количество месяцев" },
                  ] as const
                ).map((opt) => (
                  <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <input type="radio" name="recurrencePreset" checked={recurrencePreset === opt.key} onChange={() => setRecurrencePreset(opt.key)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
                {recurrencePreset === "custom" && (
                  <input
                    className={profileStyles.input}
                    type="number"
                    min={1}
                    max={24}
                    value={customMonths}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                )}
              </div>
            )}
          </CollapsibleSection>
        )}
```

(This block only ever renders in create mode — `!isEdit` — so `defaultOpen` is intentionally omitted here, defaulting to closed; there's no "already-set value" to protect in edit mode because this section never appears in edit mode.)

- [ ] **Step 5: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 6: Manual check**

Open `http://localhost:5175`, as a coach open a team → Тренировки → create a team training. Confirm: Дата/Время/Длительность/Место are visible immediately; «Настройки команды», «Напоминание», «Повторение» render as closed toggle sections; expanding each reveals the same fields as before with no behavior change; creating a training with a section left collapsed still saves its default values correctly (e.g. leaving «Напоминание» collapsed still submits the default 60-minute reminder). Then open an existing training for editing and confirm «Настройки команды» and «Напоминание» are already expanded (showing current values) — «Повторение» does not appear at all in edit mode, matching prior behavior.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/trainings/TrainingForm.tsx
git commit -m "MBA redesign Phase 3: section TrainingForm's optional fields"
```

---

### Task 3: Section `TaskForm`

**Files:**
- Modify: `frontend/src/components/tasks/TaskForm.tsx`

**Interfaces:**
- Consumes: `CollapsibleSection` from Task 1.
- No new props, no new exported interfaces — every field's `useState`, every handler, and the full submit logic stay exactly as they are. `title`, `description`, and the whole "Кому назначить" block (`targetType` and its sub-fields, required for create) stay unconditionally visible — only the deadline/plan, exercises, and confirmation-format blocks get wrapped.

- [ ] **Step 1: Add the import**

Add, alongside the other component imports near the top of the file:

```tsx
import { CollapsibleSection } from "../shared/CollapsibleSection";
```

- [ ] **Step 2: Wrap the deadline + plan block**

Replace:

```tsx
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Дедлайн</span>
          <input className={profileStyles.input} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>План тренировки</span>
          <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Без плана</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
```

with:

```tsx
        <CollapsibleSection label="Детали" defaultOpen={isEdit}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Дедлайн</span>
            <input className={profileStyles.input} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>План тренировки</span>
            <select className={profileStyles.select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Без плана</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
        </CollapsibleSection>
```

- [ ] **Step 3: Wrap the exercises + reorder block**

Replace:

```tsx
        {exercises.length > 0 && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Упражнения</span>
            {exercises.map((exercise) => (
              <label key={exercise.id} className={libraryStyles.pickerRow} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderBottom: "none", padding: "4px 0" }}>
                <input type="checkbox" checked={exerciseIds.includes(exercise.id)} onChange={() => toggleExercise(exercise.id)} />
                <span>{exercise.name}</span>
              </label>
            ))}
          </div>
        )}

        {selectedExercises.length > 1 && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Порядок выполнения</span>
            <DragReorderList
              items={selectedExercises}
              keyFn={(e) => e.id}
              onReorder={(next) => setExerciseIds(next.map((e) => e.id))}
              renderItem={(e) => <span>{e.name}</span>}
            />
          </div>
        )}
```

with:

```tsx
        {exercises.length > 0 && (
          <CollapsibleSection label="Упражнения" defaultOpen={isEdit}>
            <div className={profileStyles.field}>
              <span className={profileStyles.label}>Упражнения</span>
              {exercises.map((exercise) => (
                <label key={exercise.id} className={libraryStyles.pickerRow} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderBottom: "none", padding: "4px 0" }}>
                  <input type="checkbox" checked={exerciseIds.includes(exercise.id)} onChange={() => toggleExercise(exercise.id)} />
                  <span>{exercise.name}</span>
                </label>
              ))}
            </div>

            {selectedExercises.length > 1 && (
              <div className={profileStyles.field}>
                <span className={profileStyles.label}>Порядок выполнения</span>
                <DragReorderList
                  items={selectedExercises}
                  keyFn={(e) => e.id}
                  onReorder={(next) => setExerciseIds(next.map((e) => e.id))}
                  renderItem={(e) => <span>{e.name}</span>}
                />
              </div>
            )}
          </CollapsibleSection>
        )}
```

- [ ] **Step 4: Wrap the confirmation-format + metric block**

Replace:

```tsx
        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Формат подтверждения</span>
          {REQUIREMENT_FIELDS.map((field) => (
            <label key={field.key} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <input
                type="checkbox"
                checked={requirements[field.key]}
                onChange={(e) => setRequirements((prev) => ({ ...prev, [field.key]: e.target.checked }))}
              />
              <span>{field.label}</span>
            </label>
          ))}
        </div>

        {requirements.requireMetricValue && (
          <div className={profileStyles.fieldGrid}>
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Показатель</span>
              <input className={profileStyles.input} value={metricName} onChange={(e) => setMetricName(e.target.value)} maxLength={100} placeholder="Точность передач" />
            </label>
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Единица</span>
              <input className={profileStyles.input} value={metricUnit} onChange={(e) => setMetricUnit(e.target.value)} maxLength={30} placeholder="%" />
            </label>
          </div>
        )}
        {requirements.requireMetricValue && (
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Целевое значение</span>
            <input className={profileStyles.input} type="number" value={metricTarget} onChange={(e) => setMetricTarget(e.target.value)} />
          </label>
        )}
```

with:

```tsx
        <CollapsibleSection label="Формат подтверждения" defaultOpen={isEdit}>
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Формат подтверждения</span>
            {REQUIREMENT_FIELDS.map((field) => (
              <label key={field.key} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <input
                  type="checkbox"
                  checked={requirements[field.key]}
                  onChange={(e) => setRequirements((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>

          {requirements.requireMetricValue && (
            <div className={profileStyles.fieldGrid}>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Показатель</span>
                <input className={profileStyles.input} value={metricName} onChange={(e) => setMetricName(e.target.value)} maxLength={100} placeholder="Точность передач" />
              </label>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Единица</span>
                <input className={profileStyles.input} value={metricUnit} onChange={(e) => setMetricUnit(e.target.value)} maxLength={30} placeholder="%" />
              </label>
            </div>
          )}
          {requirements.requireMetricValue && (
            <label className={profileStyles.field}>
              <span className={profileStyles.label}>Целевое значение</span>
              <input className={profileStyles.input} type="number" value={metricTarget} onChange={(e) => setMetricTarget(e.target.value)} />
            </label>
          )}
        </CollapsibleSection>
```

- [ ] **Step 5: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 6: Manual check**

Open `http://localhost:5175`, as a coach open a team → Задания → create a task. Confirm: Название, Описание, and «Кому назначить» (with its target-type-dependent sub-fields) are visible immediately, with no collapse; «Детали», «Упражнения» (only shown if the coach has exercises in their library), «Формат подтверждения» render as closed toggle sections; expanding each behaves exactly as before (checking «Значение показателя» inside the collapsed «Формат подтверждения» still reveals the metric name/unit/target fields once expanded). Submitting with a section left collapsed still saves whatever values it holds (including all-unchecked confirmation requirements, which is a valid "simple Done button" configuration per the existing behavior). Then open an existing task for editing and confirm all three sections are already expanded.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/tasks/TaskForm.tsx
git commit -m "MBA redesign Phase 3: section TaskForm's optional fields"
```

---

### Task 4: Section `PlanForm`

**Files:**
- Modify: `frontend/src/components/library/PlanForm.tsx`

**Interfaces:**
- Consumes: `CollapsibleSection` from Task 1.
- No new props, no new exported interfaces. `name` and `sport` (both required) and `description` stay unconditionally visible — only the duration/equipment/comment block gets wrapped.

- [ ] **Step 1: Add the import**

Add, alongside the other component imports near the top of the file:

```tsx
import { CollapsibleSection } from "../shared/CollapsibleSection";
```

- [ ] **Step 2: Wrap the duration/equipment/comment block**

Replace:

```tsx
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Длительность, мин</span>
          <input
            className={profileStyles.input}
            type="number"
            min={0}
            max={600}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Инвентарь</span>
          <input className={profileStyles.input} value={equipment} onChange={(e) => setEquipment(e.target.value)} maxLength={500} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Комментарий</span>
          <textarea className={profileStyles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        </label>
```

with:

```tsx
        <CollapsibleSection label="Дополнительно" defaultOpen={isEdit}>
          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Длительность, мин</span>
            <input
              className={profileStyles.input}
              type="number"
              min={0}
              max={600}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Инвентарь</span>
            <input className={profileStyles.input} value={equipment} onChange={(e) => setEquipment(e.target.value)} maxLength={500} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Комментарий</span>
            <textarea className={profileStyles.textarea} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          </label>
        </CollapsibleSection>
```

- [ ] **Step 3: Verify build and lint**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 4: Manual check**

Open `http://localhost:5175`, as a coach open Библиотека → Планы → create a plan. Confirm: Название, Вид спорта, Описание are visible immediately; «Дополнительно» renders as a closed toggle section containing Длительность/Инвентарь/Комментарий; creating a plan with it collapsed still saves correctly (all three fields are optional server-side). Then open an existing plan for editing and confirm «Дополнительно» is already expanded.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/library/PlanForm.tsx
git commit -m "MBA redesign Phase 3: section PlanForm's optional fields"
```

---

### Task 5: Verification pass

**Files:** None — verification only, no code changes.

- [ ] **Step 1: Full lint + build pass**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
Expected: no errors.

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 2: Backend regression check**

Run: `docker compose -f docker-compose.dev.yml exec backend python -m pytest -q`
Expected: all tests pass (this plan touches zero backend files; safety net, not an expected-to-fail check).

- [ ] **Step 3: Visual walkthrough checklist**

Open `http://localhost:5175` and confirm, for each of the three forms (create and edit, as a coach with at least one team):

- [ ] Required fields (Дата/Время/Длительность for trainings; Название + Кому назначить for tasks; Название/Вид спорта for plans) are never inside a collapsed section.
- [ ] Every `CollapsibleSection` toggle shows a chevron that visibly rotates on open/expand.
- [ ] Create mode: sections default closed (except the training form's team-only section and the task form's деталей/упражнений/формата sections, and the plan form's «Дополнительно», all of which default open only when editing — confirm they're closed on create).
- [ ] Edit mode: every section that could hold an already-set value opens by default, so no existing data is hidden on first render.
- [ ] Submitting each form (both with sections left collapsed and with sections expanded and edited) still saves correctly — no regression in create/update behavior for any of the three forms.
- [ ] No visual overflow or cramped spacing in a collapsed/expanded section at a typical phone width (360-414px).

- [ ] **Step 4: Report status**

If every item above passes, Phase 3 is ready for the user's live review. If any item fails, fix it as a follow-up commit on top of this plan's tasks before declaring Phase 3 done.

---

### Task 6: Fix `forceOpenKey`'s StrictMode double-invoke bug

**Context:** added after the final whole-branch review (which ran once Tasks 1-5 and their own fix wave were merged) found that `CollapsibleSection`'s `forceOpenKey` mechanism — added in that fix wave to solve "AI draft/template prefill writes into a collapsed section invisibly" — has a bug specific to React StrictMode (`frontend/src/main.tsx` wraps the app in `<StrictMode>`, so this is live in the dev stand used for review, not just a theoretical concern): StrictMode double-invokes mount effects (setup → cleanup → setup again) on the same component instance, so a `useRef`-backed "have I ever run before" flag gets consumed by the first synthetic invocation and no longer guards the second one — `TaskForm`'s "Формат подтверждения" and `PlanForm`'s "Дополнительно" sections (the only two with `forceOpenKey`) end up forced open on every fresh mount in dev, even with no AI draft and no template, defeating the closed-by-default behavior Tasks 1-5 built.

**Files:**
- Modify: `frontend/src/components/shared/CollapsibleSection.tsx`

**Interfaces:**
- No change to `CollapsibleSectionProps` — `forceOpenKey`'s type and meaning (`number | undefined`) stay exactly as introduced. Only the internal guard logic changes. No consumer (`TaskForm.tsx`, `PlanForm.tsx`) needs any change.

- [ ] **Step 1: Replace the "first render" ref-guard with a "previous value" comparison**

The fix wave's version reads:

```tsx
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
```

Replace it with:

```tsx
export function CollapsibleSection({ label, defaultOpen = false, forceOpenKey, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const prevForceOpenKey = useRef(forceOpenKey);

  useEffect(() => {
    if (forceOpenKey !== undefined && forceOpenKey !== prevForceOpenKey.current) {
      setOpen(true);
    }
    prevForceOpenKey.current = forceOpenKey;
  }, [forceOpenKey]);
```

Why this is robust to StrictMode's double-invoke where the old version wasn't: `prevForceOpenKey` is initialized (once, at first render, via `useRef(forceOpenKey)`) to whatever `forceOpenKey` already equals — not to a boolean flag consumed on first use. On mount, no matter how many times the effect runs, `forceOpenKey` and `prevForceOpenKey.current` are still equal (nothing changed the prop between synthetic invocations), so the condition is false every time and `setOpen` never fires. It only fires once a *real* prop change occurs (e.g. `aiFillSignal` actually incrementing after a draft succeeds), at which point `forceOpenKey !== prevForceOpenKey.current` is genuinely true.

Leave the rest of the file (imports, the `CollapsibleSectionProps` interface, the JSX return) exactly as-is — `useRef` is already imported from the fix wave's change to the import line, no import changes needed here.

- [ ] **Step 2: Verify build**

Run: `docker compose -f docker-compose.dev.yml exec frontend npm run build`
Expected: exits 0.

- [ ] **Step 3: Manual check**

Open `http://localhost:5175` (a StrictMode dev build), as a coach create a new task with no template. Confirm "Формат подтверждения" renders **closed** on first paint (not force-opened by the mount-time double-invoke). Then tap «Заполнить с помощью ИИ», generate a draft, and confirm the section now opens automatically once the draft lands. Repeat the same two checks for a new plan and «Дополнительно».

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/CollapsibleSection.tsx
git commit -m "MBA redesign Phase 3: fix forceOpenKey StrictMode double-invoke bug"
```
