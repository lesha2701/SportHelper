# Coach Marketplace Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the athlete- and coach-facing screens for the coach marketplace on top of the already-shipped backend API (`/api/coaches/*`, `/api/bookings/*`), reusing this session's desktop shell (`AppShell`/`SideNav`/`BottomNav`) and existing list/form patterns.

**Architecture:** A new `components/coaches/` directory (mirrors `components/teams/`) with a shared `coaches.module.css`. Two new API/type modules (`api/coaches.ts`, `api/bookings.ts` + `types/coach.ts`, `types/booking.ts`) following the exact dto→app-type→mapper pattern already used by `api/teams.ts`/`types/metric.ts`. No router exists in this app — every multi-step screen (coach list → profile → booking) is a local `view` state machine, exactly like `TeamsScreen.tsx`'s `View` union. Coach-side marketplace settings and "Мои брони" live inside the existing `ProfileScreen.tsx`'s local state (same pattern as its existing `showHelp` toggle), not as new top-level nav destinations — only the athlete-facing discovery flow gets a new nav tab, "Тренеры".

**Tech Stack:** React + TypeScript, CSS Modules, no router, no frontend test framework (this project has none — verification is `tsc --noEmit` for correctness and manual browser checks via screenshots for UX, matching how this session's earlier desktop-layout work was verified).

**Spec:** [docs/superpowers/specs/2026-09-05-coach-marketplace-design.md](../specs/2026-09-05-coach-marketplace-design.md)
**Backend plan (API this builds on):** [docs/superpowers/plans/2026-09-05-coach-marketplace-backend.md](2026-09-05-coach-marketplace-backend.md)

## Global Constraints

- Backend API is already live on `main` — do not modify any backend file in this plan. The exact response shapes below are copied from the real, already-merged Pydantic schemas (`backend/app/schemas/coach_marketplace.py`, `coach_search.py`, `booking.py`), not the original spec draft — some fields differ from the spec (e.g. `float` not `Decimal`, `is_completed`/`has_review` derived booleans).
- **Known gap, out of scope for this plan:** there is no `GET /api/bookings/coach` — a coach cannot see who booked them through the API yet. Do not build a "coach's incoming bookings" screen. Only athlete-side "Мои брони" (`GET /api/bookings/me`, always athlete-scoped) is in scope.
- No payment UI — `price_per_session` is display-only everywhere.
- No booking cancellation UI — the API has none.
- Reuse existing design tokens (`index.css` custom properties) and existing shared components (`Icon`, `StateScreen`, `AuthenticatedImage` is NOT relevant here — coach avatars use `photo_url`, a plain external URL, not the team-logo upload system).
- No new npm dependency. No new icon names added to `components/shared/Icon.tsx` — use only these existing ones: `home, trophy, book, calendar, user, users, dumbbell, ball, clipboard, alert-triangle, inbox, lock, sparkles, check, check-circle, edit, plus, chevron-right, chevron-left, x, trash, search, bell, settings, sun, moon, grip, clock, award, image, video, filter, map-pin, flag`. Render a star rating as the plain `"★"` character, not an icon.
- Every task ends with `docker compose -f docker-compose.dev.yml exec backend python -m pytest -q` still green (183 passing as of this plan — confirms no backend file was touched) plus `cd frontend && npx tsc --noEmit` clean, plus a browser screenshot proving the new UI renders and works at both mobile (<900px) and desktop (≥900px) width, per this session's `useIsDesktop` breakpoint.
- Follow existing conventions exactly: DTO interfaces name fields snake_case (matching the JSON wire shape), app-facing interfaces name fields camelCase, a `mapXDto` function converts one to the other — see `types/metric.ts` for the exact shape to copy.

---

### Task 1: API client and types

**Files:**
- Create: `frontend/src/types/coach.ts`
- Create: `frontend/src/types/booking.ts`
- Create: `frontend/src/api/coaches.ts`
- Create: `frontend/src/api/bookings.ts`

**Interfaces:**
- Produces: `CoachMarketplaceSettings`, `CoachMarketplaceSettingsInput`, `AvailabilityWindow`, `AvailabilityWindowInput`, `CoachCard`, `CoachPublicProfile`, `OpenSlot`, `CoachReview` (types/coach.ts); `Booking`, `BookingInput`, `ReviewInput`, `Review` (types/booking.ts) — every later task imports from these two files and the two `api/*.ts` files. No task after this one defines a new type for marketplace/booking data — extend these files instead of duplicating shapes.

- [ ] **Step 1: Write `types/coach.ts`**

```typescript
// frontend/src/types/coach.ts

export interface CoachMarketplaceSettingsDto {
  user_id: string;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface CoachMarketplaceSettings {
  userId: string;
  isListed: boolean;
  pricePerSession: number | null;
  currency: string;
  offersOnline: boolean;
  offersOffline: boolean;
  location: string | null;
  sessionDurationMinutes: number | null;
}

export function mapCoachMarketplaceSettingsDto(dto: CoachMarketplaceSettingsDto): CoachMarketplaceSettings {
  return {
    userId: dto.user_id,
    isListed: dto.is_listed,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    location: dto.location,
    sessionDurationMinutes: dto.session_duration_minutes,
  };
}

export interface CoachMarketplaceSettingsInput {
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface AvailabilityWindowDto {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface AvailabilityWindow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export function mapAvailabilityWindowDto(dto: AvailabilityWindowDto): AvailabilityWindow {
  return { id: dto.id, weekday: dto.weekday, startTime: dto.start_time, endTime: dto.end_time };
}

export interface AvailabilityWindowInput {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface CoachCardDto {
  user_id: string;
  full_name: string;
  photo_url: string | null;
  sport: string;
  specialization: string | null;
  description: string | null;
  experience_years: number | null;
  average_rating: number | null;
  review_count: number;
  price_per_session: number | null;
  currency: string;
  location: string | null;
  offers_online: boolean;
  offers_offline: boolean;
  next_available_slot: string | null;
}

export interface CoachCard {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  sport: string;
  specialization: string | null;
  description: string | null;
  experienceYears: number | null;
  averageRating: number | null;
  reviewCount: number;
  pricePerSession: number | null;
  currency: string;
  location: string | null;
  offersOnline: boolean;
  offersOffline: boolean;
  nextAvailableSlot: string | null;
}

export function mapCoachCardDto(dto: CoachCardDto): CoachCard {
  return {
    userId: dto.user_id,
    fullName: dto.full_name,
    photoUrl: dto.photo_url,
    sport: dto.sport,
    specialization: dto.specialization,
    description: dto.description,
    experienceYears: dto.experience_years,
    averageRating: dto.average_rating,
    reviewCount: dto.review_count,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    location: dto.location,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    nextAvailableSlot: dto.next_available_slot,
  };
}

export interface CoachReviewDto {
  id: string;
  athlete_first_name: string;
  rating: number;
  text: string | null;
  created_at: string;
}

export interface CoachReview {
  id: string;
  athleteFirstName: string;
  rating: number;
  text: string | null;
  createdAt: string;
}

function mapCoachReviewDto(dto: CoachReviewDto): CoachReview {
  return { id: dto.id, athleteFirstName: dto.athlete_first_name, rating: dto.rating, text: dto.text, createdAt: dto.created_at };
}

export interface CoachPublicProfileDto extends CoachCardDto {
  session_duration_minutes: number | null;
  availability: AvailabilityWindowDto[];
  recent_reviews: CoachReviewDto[];
}

export interface CoachPublicProfile extends CoachCard {
  sessionDurationMinutes: number | null;
  availability: AvailabilityWindow[];
  recentReviews: CoachReview[];
}

export function mapCoachPublicProfileDto(dto: CoachPublicProfileDto): CoachPublicProfile {
  return {
    ...mapCoachCardDto(dto),
    sessionDurationMinutes: dto.session_duration_minutes,
    availability: dto.availability.map(mapAvailabilityWindowDto),
    recentReviews: dto.recent_reviews.map(mapCoachReviewDto),
  };
}

export interface OpenSlotDto {
  starts_at: string;
  duration_minutes: number;
}

export interface OpenSlot {
  startsAt: string;
  durationMinutes: number;
}

export function mapOpenSlotDto(dto: OpenSlotDto): OpenSlot {
  return { startsAt: dto.starts_at, durationMinutes: dto.duration_minutes };
}

export interface CoachListFilters {
  sport?: string;
  location?: string;
  max_price?: number;
  min_rating?: number;
  format?: "online" | "offline";
  min_experience_years?: number;
}
```

- [ ] **Step 2: Write `types/booking.ts`**

```typescript
// frontend/src/types/booking.ts

export interface BookingDto {
  id: string;
  coach_user_id: string;
  coach_full_name: string;
  athlete_user_id: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  status: string;
  is_completed: boolean;
  training_id: string;
  has_review: boolean;
}

export interface Booking {
  id: string;
  coachUserId: string;
  coachFullName: string;
  athleteUserId: string;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  status: string;
  isCompleted: boolean;
  trainingId: string;
  hasReview: boolean;
}

export function mapBookingDto(dto: BookingDto): Booking {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    athleteUserId: dto.athlete_user_id,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    status: dto.status,
    isCompleted: dto.is_completed,
    trainingId: dto.training_id,
    hasReview: dto.has_review,
  };
}

export interface BookingInput {
  coach_user_id: string;
  starts_at: string;
  format: "online" | "offline";
}

export interface ReviewInput {
  rating: number;
  text: string | null;
}

export interface ReviewDto {
  id: string;
  booking_id: string;
  rating: number;
  text: string | null;
}
```

- [ ] **Step 3: Write `api/coaches.ts`**

```typescript
// frontend/src/api/coaches.ts
import { apiRequest } from "./client";
import {
  mapAvailabilityWindowDto,
  mapCoachCardDto,
  mapCoachMarketplaceSettingsDto,
  mapCoachPublicProfileDto,
  mapOpenSlotDto,
  type AvailabilityWindow,
  type AvailabilityWindowDto,
  type AvailabilityWindowInput,
  type CoachCard,
  type CoachCardDto,
  type CoachListFilters,
  type CoachMarketplaceSettings,
  type CoachMarketplaceSettingsDto,
  type CoachMarketplaceSettingsInput,
  type CoachPublicProfile,
  type CoachPublicProfileDto,
  type OpenSlot,
  type OpenSlotDto,
} from "../types/coach";

export async function getMyMarketplaceSettings(token: string): Promise<CoachMarketplaceSettings> {
  const dto = await apiRequest<CoachMarketplaceSettingsDto>("/api/coaches/me/marketplace-settings", { token });
  return mapCoachMarketplaceSettingsDto(dto);
}

export async function updateMyMarketplaceSettings(
  token: string,
  input: CoachMarketplaceSettingsInput,
): Promise<CoachMarketplaceSettings> {
  const dto = await apiRequest<CoachMarketplaceSettingsDto>("/api/coaches/me/marketplace-settings", {
    method: "PUT",
    token,
    body: input,
  });
  return mapCoachMarketplaceSettingsDto(dto);
}

export async function getMyAvailability(token: string): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>("/api/coaches/me/availability", { token });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function replaceMyAvailability(token: string, windows: AvailabilityWindowInput[]): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>("/api/coaches/me/availability", {
    method: "PUT",
    token,
    body: windows,
  });
  return dtos.map(mapAvailabilityWindowDto);
}

function filtersToQuery(filters: CoachListFilters): string {
  const params = new URLSearchParams();
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.location) params.set("location", filters.location);
  if (filters.max_price !== undefined) params.set("max_price", String(filters.max_price));
  if (filters.min_rating !== undefined) params.set("min_rating", String(filters.min_rating));
  if (filters.format) params.set("format", filters.format);
  if (filters.min_experience_years !== undefined) params.set("min_experience_years", String(filters.min_experience_years));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listCoaches(token: string, filters: CoachListFilters = {}): Promise<CoachCard[]> {
  const dtos = await apiRequest<CoachCardDto[]>(`/api/coaches${filtersToQuery(filters)}`, { token });
  return dtos.map(mapCoachCardDto);
}

export async function getCoachPublicProfile(token: string, coachUserId: string): Promise<CoachPublicProfile> {
  const dto = await apiRequest<CoachPublicProfileDto>(`/api/coaches/${coachUserId}`, { token });
  return mapCoachPublicProfileDto(dto);
}

export async function getCoachOpenSlots(
  token: string,
  coachUserId: string,
  fromDate: string,
  toDate: string,
): Promise<OpenSlot[]> {
  const dtos = await apiRequest<OpenSlotDto[]>(
    `/api/coaches/${coachUserId}/slots?from_date=${fromDate}&to_date=${toDate}`,
    { token },
  );
  return dtos.map(mapOpenSlotDto);
}
```

- [ ] **Step 4: Write `api/bookings.ts`**

```typescript
// frontend/src/api/bookings.ts
import { apiRequest } from "./client";
import { mapBookingDto, type Booking, type BookingDto, type BookingInput, type ReviewDto, type ReviewInput } from "../types/booking";

export async function createBooking(token: string, input: BookingInput): Promise<Booking> {
  const dto = await apiRequest<BookingDto>("/api/bookings", { method: "POST", token, body: input });
  return mapBookingDto(dto);
}

export async function listMyBookings(token: string): Promise<Booking[]> {
  const dtos = await apiRequest<BookingDto[]>("/api/bookings/me", { token });
  return dtos.map(mapBookingDto);
}

export async function reviewBooking(token: string, bookingId: string, input: ReviewInput): Promise<void> {
  await apiRequest<ReviewDto>(`/api/bookings/${bookingId}/reviews`, { method: "POST", token, body: input });
}
```

- [ ] **Step 5: Verify**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors (these files aren't imported anywhere yet, so this only checks their own internal type-correctness).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/coach.ts frontend/src/types/booking.ts frontend/src/api/coaches.ts frontend/src/api/bookings.ts
git commit -m "$(cat <<'EOF'
Add coach marketplace API client and types

DTO/app-type/mapper layer for the already-shipped backend API
(/api/coaches/*, /api/bookings/*), following the existing
teams.ts/metric.ts pattern. Not wired into any screen yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Coach marketplace settings screen

**Files:**
- Create: `frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx`
- Create: `frontend/src/components/coaches/coaches.module.css`
- Modify: `frontend/src/components/profile/ProfileScreen.tsx` — add `showMarketplaceSettings` local state, route to the new screen
- Modify: `frontend/src/components/profile/ProfileSummary.tsx` — add an entry-point card, coach mode only

**Interfaces:**
- Consumes: `getMyMarketplaceSettings`, `updateMyMarketplaceSettings` (Task 1's `api/coaches.ts`).
- Produces: `coaches.module.css`'s classes (`.filterBar`, `.slotGrid`, `.formatBadge`, `.starRating`, etc. — this task only needs a subset; later tasks extend this same file, don't create a second one).

- [ ] **Step 1: Write `coaches.module.css`** (only the classes this task needs — later tasks append more to this same file)

```css
/* frontend/src/components/coaches/coaches.module.css
   Shared across the whole coach-marketplace feature — one file per the
   project's convention (teams.module.css is shared the same way across
   TeamsScreen/MyTeamsSection/TeamDetailScreen/TeamTrainingsTab). */

.toggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.toggleLabel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggleTitle {
  font-weight: 700;
  color: var(--color-text);
}

.toggleHint {
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.switch {
  position: relative;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  border: none;
  background: var(--color-border-strong);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.switchOn {
  background: var(--color-primary);
}

.switchKnob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--transition-fast);
}

.switchOn .switchKnob {
  transform: translateX(20px);
}

.formatRow {
  display: flex;
  gap: 8px;
}

.formatChip,
.formatChipActive {
  flex: 1;
  padding: 10px;
  text-align: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: var(--font-display);
  font-weight: 700;
  cursor: pointer;
}

.formatChipActive {
  border-color: var(--color-primary);
  background: var(--color-primary-glow);
  color: var(--color-primary);
}
```

- [ ] **Step 2: Write `CoachMarketplaceSettingsScreen.tsx`**

```tsx
// frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx
import { useEffect, useState } from "react";
import { getMyMarketplaceSettings, updateMyMarketplaceSettings } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { CoachMarketplaceSettings } from "../../types/coach";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: CoachMarketplaceSettings };

export function CoachMarketplaceSettingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isListed, setIsListed] = useState(false);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("RUB");
  const [offersOnline, setOffersOnline] = useState(false);
  const [offersOffline, setOffersOffline] = useState(false);
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyMarketplaceSettings(token)
      .then((settings) => {
        setState({ status: "ready", settings });
        setIsListed(settings.isListed);
        setPrice(settings.pricePerSession?.toString() ?? "");
        setCurrency(settings.currency);
        setOffersOnline(settings.offersOnline);
        setOffersOffline(settings.offersOffline);
        setLocation(settings.location ?? "");
        setDuration(settings.sessionDurationMinutes?.toString() ?? "60");
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить настройки";
        setState({ status: "error", message });
      });
  }, [token]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка настроек…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить настройки" description={state.message} />;
  }

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const settings = await updateMyMarketplaceSettings(token, {
        is_listed: isListed,
        price_per_session: price ? Number(price) : null,
        currency,
        offers_online: offersOnline,
        offers_offline: offersOffline,
        location: location.trim() || null,
        session_duration_minutes: duration ? Number(duration) : null,
      });
      setState({ status: "ready", settings });
    } catch (err) {
      if (err instanceof ApiError && err.code === "availability_required") {
        setError("Сначала задайте недельное расписание — без него нельзя включить листинг.");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось сохранить настройки");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <div className={profileStyles.headerRow}>
          <button type="button" className={profileStyles.iconButton} onClick={onBack} aria-label="Назад">
            ←
          </button>
          <h1 className={profileStyles.pageHeading}>Маркетплейс тренеров</h1>
        </div>

        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Показывать меня в маркетплейсе</span>
            <span className={styles.toggleHint}>Атлеты смогут найти вас и записаться на тренировку</span>
          </div>
          <button
            type="button"
            className={isListed ? `${styles.switch} ${styles.switchOn}` : styles.switch}
            onClick={() => setIsListed((v) => !v)}
            role="switch"
            aria-checked={isListed}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Цена за тренировку</span>
          <input
            className={profileStyles.input}
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="2000"
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Валюта</span>
          <input
            className={profileStyles.input}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>

        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Формат</span>
          <div className={styles.formatRow}>
            <button
              type="button"
              className={offersOnline ? styles.formatChipActive : styles.formatChip}
              onClick={() => setOffersOnline((v) => !v)}
            >
              Онлайн
            </button>
            <button
              type="button"
              className={offersOffline ? styles.formatChipActive : styles.formatChip}
              onClick={() => setOffersOffline((v) => !v)}
            >
              Очно
            </button>
          </div>
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Город (для очных тренировок)</span>
          <input className={profileStyles.input} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Длительность тренировки, мин</span>
          <input
            className={profileStyles.input}
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ProfileScreen.tsx`**

```tsx
// add import
import { CoachMarketplaceSettingsScreen } from "../coaches/CoachMarketplaceSettingsScreen";

// inside ProfileScreen, add alongside the existing showHelp state:
const [showMarketplaceSettings, setShowMarketplaceSettings] = useState(false);

// add a branch alongside the existing `if (showHelp) { ... }` branch:
if (showMarketplaceSettings) {
  return <CoachMarketplaceSettingsScreen token={token} onBack={() => setShowMarketplaceSettings(false)} />;
}

// pass a new prop to ProfileSummary:
onOpenMarketplaceSettings={() => setShowMarketplaceSettings(true)}
```

- [ ] **Step 4: Add the entry-point card in `ProfileSummary.tsx`**

Add `onOpenMarketplaceSettings: () => void` to `ProfileSummaryProps`, and inside the `mode === "coach" && profile.coach` block, right after the existing `formActions` div, add:

```tsx
{mode === "coach" && profile.coach && (
  <div className={styles.card}>
    <button type="button" className={styles.buttonSecondary} onClick={onOpenMarketplaceSettings}>
      <Icon name="settings" size={17} />
      Маркетплейс тренеров
    </button>
  </div>
)}
```

(Place this as a sibling of the existing `mode === "coach"` card, not nested inside it — a separate card, same as how "Моя статистика" is its own card below the profile card.)

- [ ] **Step 5: Verify — `tsc` then browser**

```bash
cd frontend && npx tsc --noEmit
```

Then in the Browser pane: open the app, switch to coach mode if needed, go to Профиль → «Маркетплейс тренеров», toggle the listing switch, fill price/format/duration, hit Сохранить. Expect either a successful save (if availability was set in an earlier manual test) or the `availability_required` error message (expected — Task 3 adds the availability editor). Reload the screen and confirm the fields you entered persisted (GET reflects the PUT). Screenshot both mobile and desktop widths.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx frontend/src/components/coaches/coaches.module.css frontend/src/components/profile/ProfileScreen.tsx frontend/src/components/profile/ProfileSummary.tsx
git commit -m "$(cat <<'EOF'
Add coach marketplace settings screen

Listing toggle, price/currency/format/location/duration — reachable from
Profile → "Маркетплейс тренеров" (coach mode only). Availability editor
is a separate task; without it, enabling the listing correctly surfaces
the backend's availability_required error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Weekly availability editor

**Files:**
- Modify: `frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx` — append the availability section
- Modify: `frontend/src/components/coaches/coaches.module.css` — append availability-row classes

**Interfaces:**
- Consumes: `getMyAvailability`, `replaceMyAvailability` (Task 1).

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.weekdayRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.weekdayRow:last-child {
  border-bottom: none;
}

.weekdaySelect {
  font: inherit;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}

.timeInput {
  font: inherit;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  width: 110px;
}

.removeRowButton {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 6px;
}
```

- [ ] **Step 2: Append the availability section to `CoachMarketplaceSettingsScreen.tsx`**

Add imports: `getMyAvailability, replaceMyAvailability` from `../../api/coaches`, `type AvailabilityWindow` from `../../types/coach`, `Icon` from `../shared/Icon`.

Add state and a load effect (runs alongside the existing settings load):

```tsx
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface WindowDraft {
  weekday: number;
  startTime: string;
  endTime: string;
}

// inside the component, alongside the settings state:
const [windows, setWindows] = useState<WindowDraft[]>([]);
const [availabilityError, setAvailabilityError] = useState<string | null>(null);
const [savingAvailability, setSavingAvailability] = useState(false);

useEffect(() => {
  getMyAvailability(token).then((loaded) =>
    setWindows(loaded.map((w: AvailabilityWindow) => ({ weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }))),
  );
}, [token]);

const handleSaveAvailability = async () => {
  setAvailabilityError(null);
  setSavingAvailability(true);
  try {
    await replaceMyAvailability(
      token,
      windows.map((w) => ({ weekday: w.weekday, start_time: `${w.startTime}:00`, end_time: `${w.endTime}:00` })),
    );
  } catch (err) {
    setAvailabilityError(err instanceof ApiError && err.code === "overlapping_availability"
      ? "Окна пересекаются — поправьте время."
      : err instanceof ApiError ? err.message : "Не удалось сохранить расписание");
  } finally {
    setSavingAvailability(false);
  }
};
```

Add JSX, as a second `profileStyles.card` after the settings card (before the closing `</div>` of the `profileStyles.screen` wrapper):

```tsx
<div className={profileStyles.card}>
  <h2 className={profileStyles.title}>Недельное расписание</h2>
  <p className={profileStyles.subtitle}>Когда вы обычно свободны — из этого система нарежет слоты для записи.</p>

  {windows.map((w, i) => (
    <div className={styles.weekdayRow} key={i}>
      <select
        className={styles.weekdaySelect}
        value={w.weekday}
        onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}
      >
        {WEEKDAY_LABELS.map((label, idx) => (
          <option key={idx} value={idx}>
            {label}
          </option>
        ))}
      </select>
      <input
        className={styles.timeInput}
        type="time"
        value={w.startTime}
        onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))}
      />
      <span>—</span>
      <input
        className={styles.timeInput}
        type="time"
        value={w.endTime}
        onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))}
      />
      <button
        type="button"
        className={styles.removeRowButton}
        onClick={() => setWindows(windows.filter((_, j) => j !== i))}
        aria-label="Удалить"
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  ))}

  <button
    type="button"
    className={profileStyles.buttonSecondary}
    onClick={() => setWindows([...windows, { weekday: 0, startTime: "10:00", endTime: "12:00" }])}
  >
    <Icon name="plus" size={16} />
    Добавить окно
  </button>

  {availabilityError && <p className={profileStyles.error}>{availabilityError}</p>}

  <div className={profileStyles.formActions}>
    <button
      type="button"
      className={profileStyles.buttonPrimary}
      onClick={() => void handleSaveAvailability()}
      disabled={savingAvailability}
    >
      {savingAvailability ? "Сохранение…" : "Сохранить расписание"}
    </button>
  </div>
</div>
```

- [ ] **Step 3: Verify — `tsc` then browser**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane: add 1-2 availability windows, save, reload the screen, confirm they round-trip. Add two overlapping windows on the same day, save, confirm the "окна пересекаются" error surfaces. Then go back to the settings section above and toggle the listing on with a price/format/duration set — confirm it now saves successfully (the `availability_required` error from Task 2 is gone once a window exists). Screenshot at both widths.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "$(cat <<'EOF'
Add weekly availability editor to coach marketplace settings

Add/remove day+time-range rows, full-replace save (matches the backend's
PUT semantics). Overlap and empty-availability errors from the API
surface as inline messages.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Navigation wiring and coach-list screen shell

**Files:**
- Create: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx`
- Modify: `frontend/src/Workspace.tsx` — add `"coaches"` to `CoachTab`/`PlayerTab` unions, add nav items, add tab content wiring

**Interfaces:**
- Produces: `CoachMarketplaceScreen` renders only a heading + `StateScreen kind="empty"` placeholder in this task — Task 5 fills in the real list. This task is purely about the tab existing and being reachable, verified in the browser before any real data-fetching code is added, to isolate nav-wiring mistakes from list-rendering mistakes.

- [ ] **Step 1: Write the screen shell**

```tsx
// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { StateScreen } from "../StateScreen";

export function CoachMarketplaceScreen({ token }: { token: string }) {
  void token;
  return <StateScreen kind="empty" title="Тренеры" description="Список тренеров появится здесь." />;
}
```

- [ ] **Step 2: Wire into `Workspace.tsx`**

Read the current file first — `CoachTab`, `PlayerTab`, `COACH_NAV_ITEMS`, `PLAYER_NAV_ITEMS`, and `CoachTabContent` are all in this file (or `CoachTabContent`'s own file, check the import). Add `"coaches"` as a new member of both `CoachTab` and `PlayerTab` union types, add an entry to both `COACH_NAV_ITEMS` and `PLAYER_NAV_ITEMS` arrays (`{ key: "coaches", label: "Тренеры", icon: "users" }` — reuse the existing `users` icon, don't invent a new one), and wire `tab === "coaches"` to render `<CoachMarketplaceScreen token={token} />` in both the coach and player tab-content branches (same place `teams`/`calendar`/`profile` are handled).

- [ ] **Step 3: Verify in browser**

Reload, confirm a "Тренеры" tab/nav item appears (bottom bar on mobile, sidebar on desktop), click it, confirm the empty-state screen renders, confirm the previously-active tab's highlight moves correctly. Screenshot both widths.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/Workspace.tsx
git commit -m "$(cat <<'EOF'
Add "Тренеры" nav tab (empty-state shell)

New CoachTab/PlayerTab entry, wired into both nav arrays and tab
content. Placeholder screen only — the real coach list is the next task,
kept separate so a nav-wiring mistake and a list-rendering mistake never
land in the same diff.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Coach list with filters

**Files:**
- Modify: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx`
- Modify: `frontend/src/components/coaches/coaches.module.css` — append list-card and filter-bar classes

**Interfaces:**
- Consumes: `listCoaches` (Task 1).
- Produces: `CoachMarketplaceScreen` now owns a `view` state (`{screen:"list"}` initially) — Task 6 extends this same union with a `{screen:"profile", coachUserId}` member and reads `onOpenCoach` from this task's list.

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.filterBar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px;
  padding-bottom: 0;
}

.filterInput {
  font: inherit;
  font-size: 13.5px;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  flex: 1;
  min-width: 100px;
}

.coachCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}

.coachCardTop {
  display: flex;
  gap: 12px;
  align-items: center;
}

.coachAvatar {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-primary-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--color-primary);
}

.coachName {
  margin: 0;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
}

.coachMeta {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.starRating {
  color: var(--color-warning, #b6790f);
  font-weight: 700;
}

.coachDescription {
  margin: 0;
  font-size: 13.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.coachFooterRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.coachPrice {
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--color-primary);
}
```

- [ ] **Step 2: Rewrite `CoachMarketplaceScreen.tsx`**

```tsx
// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { useEffect, useState } from "react";
import { listCoaches } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachCard, CoachListFilters } from "../../types/coach";
import teamStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; coaches: CoachCard[] };

function CoachCardView({ coach, onOpen }: { coach: CoachCard; onOpen: () => void }) {
  return (
    <button type="button" className={styles.coachCard} onClick={onOpen}>
      <div className={styles.coachCardTop}>
        {coach.photoUrl ? (
          <img className={styles.coachAvatar} src={coach.photoUrl} alt="" />
        ) : (
          <div className={styles.coachAvatar}>{coach.fullName.charAt(0).toUpperCase()}</div>
        )}
        <div>
          <h3 className={styles.coachName}>{coach.fullName}</h3>
          <p className={styles.coachMeta}>
            {coach.sport}
            {coach.experienceYears !== null ? ` · ${coach.experienceYears} лет опыта` : ""}
          </p>
          {coach.averageRating !== null && (
            <p className={styles.coachMeta}>
              <span className={styles.starRating}>★ {coach.averageRating.toFixed(1)}</span> ({coach.reviewCount})
            </p>
          )}
        </div>
      </div>

      {coach.description && <p className={styles.coachDescription}>{coach.description}</p>}

      <div className={styles.coachFooterRow}>
        <span className={styles.coachPrice}>
          {coach.pricePerSession !== null ? `${coach.pricePerSession} ${coach.currency}` : "Цена не указана"}
        </span>
        {coach.location && (
          <span className={teamStyles.teamMeta}>
            <Icon name="map-pin" size={13} /> {coach.location}
          </span>
        )}
      </div>
    </button>
  );
}

export function CoachMarketplaceScreen({ token, onOpenCoach }: { token: string; onOpenCoach: (coachUserId: string) => void }) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [sport, setSport] = useState("");
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const load = (filters: CoachListFilters) => {
    setState({ status: "loading" });
    listCoaches(token, filters)
      .then((coaches) => setState({ status: "ready", coaches }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить список тренеров";
        setState({ status: "error", message });
      });
  };

  useEffect(() => {
    load({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applyFilters = () => {
    load({
      sport: sport.trim() || undefined,
      location: location.trim() || undefined,
      max_price: maxPrice ? Number(maxPrice) : undefined,
    });
  };

  return (
    <div className={teamStyles.screen}>
      <h1 className={teamStyles.heading}>Тренеры</h1>

      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          placeholder="Вид спорта"
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          onBlur={applyFilters}
        />
        <input
          className={styles.filterInput}
          placeholder="Город"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onBlur={applyFilters}
        />
        <input
          className={styles.filterInput}
          type="number"
          placeholder="Цена до"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          onBlur={applyFilters}
        />
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка тренеров…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить тренеров" description={state.message} onRetry={() => load({})} />}
      {state.status === "ready" && state.coaches.length === 0 && (
        <StateScreen kind="empty" title="Пока никого нет" description="Тренеры появятся здесь, когда включат листинг." />
      )}
      {state.status === "ready" && state.coaches.length > 0 && (
        <div className={teamStyles.cardGrid}>
          {state.coaches.map((coach) => (
            <CoachCardView key={coach.userId} coach={coach} onOpen={() => onOpenCoach(coach.userId)} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `Workspace.tsx`'s call site**

`CoachMarketplaceScreen` now requires an `onOpenCoach` prop. For this task, pass a no-op placeholder (`onOpenCoach={() => {}}`) — Task 6 replaces it with real navigation into the profile screen. Also remove the unused `token` `void` statement from Task 4's shell (no longer relevant, the whole file was rewritten in Step 2).

- [ ] **Step 4: Verify — `tsc` then browser**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane: open "Тренеры". If a coach was listed during Tasks 2-3's manual testing, confirm their card renders with correct name/sport/price. Type into the filter fields and tab away (triggers `onBlur`), confirm the list re-fetches. If no coach is listed yet, confirm the empty state renders correctly. Screenshot both widths — at desktop, confirm the `.cardGrid` reuse means cards wrap into multiple columns exactly like the team list does.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/components/coaches/coaches.module.css frontend/src/Workspace.tsx
git commit -m "$(cat <<'EOF'
Add coach discovery list with filters

Reuses teams.module.css's .screen/.cardGrid for layout consistency with
the rest of the app. Sport/location/price filters re-fetch on blur.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Public coach profile screen

**Files:**
- Create: `frontend/src/components/coaches/CoachPublicProfileScreen.tsx`
- Modify: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx` — own the `view` state, render the profile screen for `{screen:"profile"}`
- Modify: `frontend/src/components/coaches/coaches.module.css` — append profile-page classes
- Modify: `frontend/src/Workspace.tsx` — remove the Task 5 placeholder prop (no longer needed; `CoachMarketplaceScreen` now manages its own navigation internally, matching `TeamsScreen`'s self-contained `View` pattern)

**Interfaces:**
- Consumes: `getCoachPublicProfile` (Task 1).
- Produces: `onBook: () => void` prop on `CoachPublicProfileScreen`, wired to a no-op in this task — Task 7 replaces it with the real booking flow.

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.profileHero {
  display: flex;
  gap: 16px;
  align-items: center;
}

.profileAvatarLg {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--color-primary-glow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--color-primary);
}

.reviewRow {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.reviewRow:last-child {
  border-bottom: none;
}

.reviewHeader {
  display: flex;
  justify-content: space-between;
  font-size: 13.5px;
  font-weight: 700;
}

.reviewText {
  margin: 4px 0 0;
  font-size: 13.5px;
  color: var(--color-text-secondary);
}

.availabilityRow {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13.5px;
}
```

- [ ] **Step 2: Write `CoachPublicProfileScreen.tsx`**

```tsx
// frontend/src/components/coaches/CoachPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getCoachPublicProfile } from "../../api/coaches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { CoachPublicProfile } from "../../types/coach";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function CoachPublicProfileScreen({
  token,
  coachUserId,
  onBack,
  onBook,
}: {
  token: string;
  coachUserId: string;
  onBack: () => void;
  onBook: () => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: CoachPublicProfile }>({
    status: "loading",
  });

  useEffect(() => {
    getCoachPublicProfile(token, coachUserId)
      .then((profile) => setState({ status: "ready", profile }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить профиль тренера";
        setState({ status: "error", message });
      });
  }, [token, coachUserId]);

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка профиля…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить профиль" description={state.message} />;

  const { profile } = state;
  const formats = [profile.offersOnline && "Онлайн", profile.offersOffline && "Очно"].filter(Boolean).join(" · ");

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <button type="button" className={profileStyles.iconButton} onClick={onBack} aria-label="Назад">
          ←
        </button>

        <div className={styles.profileHero}>
          {profile.photoUrl ? (
            <img className={styles.profileAvatarLg} src={profile.photoUrl} alt="" />
          ) : (
            <div className={styles.profileAvatarLg}>{profile.fullName.charAt(0).toUpperCase()}</div>
          )}
          <div>
            <h1 className={profileStyles.title}>{profile.fullName}</h1>
            <p className={profileStyles.subtitle}>
              {profile.sport}
              {profile.experienceYears !== null ? ` · ${profile.experienceYears} лет опыта` : ""}
            </p>
            {profile.averageRating !== null && (
              <p className={profileStyles.subtitle}>
                <span className={styles.starRating}>★ {profile.averageRating.toFixed(1)}</span> ({profile.reviewCount} отзывов)
              </p>
            )}
          </div>
        </div>

        {profile.description && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowValue}>{profile.description}</span>
          </div>
        )}

        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Цена</span>
          <span className={profileStyles.rowValue}>
            {profile.pricePerSession !== null ? `${profile.pricePerSession} ${profile.currency}` : "Не указана"}
            {profile.sessionDurationMinutes ? ` / ${profile.sessionDurationMinutes} мин` : ""}
          </span>
        </div>
        {formats && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Формат</span>
            <span className={profileStyles.rowValue}>{formats}</span>
          </div>
        )}
        {profile.location && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Город</span>
            <span className={profileStyles.rowValue}>{profile.location}</span>
          </div>
        )}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onBook}>
            Записаться
          </button>
        </div>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Расписание</h2>
        {profile.availability.length === 0 && <p className={profileStyles.subtitle}>Пока нет доступного времени.</p>}
        {profile.availability.map((w) => (
          <div className={styles.availabilityRow} key={w.id}>
            <span>{WEEKDAY_LABELS[w.weekday]}</span>
            <span>
              {w.startTime.slice(0, 5)} — {w.endTime.slice(0, 5)}
            </span>
          </div>
        ))}
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Отзывы ({profile.reviewCount})</h2>
        {profile.recentReviews.length === 0 && <p className={profileStyles.subtitle}>Пока нет отзывов.</p>}
        {profile.recentReviews.map((review) => (
          <div className={styles.reviewRow} key={review.id}>
            <div className={styles.reviewHeader}>
              <span>{review.athleteFirstName}</span>
              <span className={styles.starRating}>★ {review.rating}</span>
            </div>
            {review.text && <p className={styles.reviewText}>{review.text}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Give `CoachMarketplaceScreen` its own `view` state**

Replace the `onOpenCoach` prop (Task 5's placeholder) with internal state:

```tsx
// add import
import { CoachPublicProfileScreen } from "./CoachPublicProfileScreen";

// replace the component's props (no longer takes onOpenCoach — self-contained, like TeamsScreen)
export function CoachMarketplaceScreen({ token }: { token: string }) {
  const [view, setView] = useState<{ screen: "list" } | { screen: "profile"; coachUserId: string }>({ screen: "list" });
  // ...existing list state/effects unchanged...

  if (view.screen === "profile") {
    return (
      <CoachPublicProfileScreen
        token={token}
        coachUserId={view.coachUserId}
        onBack={() => setView({ screen: "list" })}
        onBook={() => {}}
      />
    );
  }

  // ...existing list JSX, with onOpen={() => setView({ screen: "profile", coachUserId: coach.userId })}...
}
```

- [ ] **Step 4: Update `Workspace.tsx`'s call site**

Remove the `onOpenCoach={() => {}}` prop passed in Task 5 (the component no longer accepts it) — just `<CoachMarketplaceScreen token={token} />`.

- [ ] **Step 5: Verify — `tsc` then browser**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane: click into a coach card, confirm the profile renders (bio, price, format, location, availability list, reviews section — empty state if none). Click "Назад", confirm it returns to the list. Screenshot both widths.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/coaches/CoachPublicProfileScreen.tsx frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/components/coaches/coaches.module.css frontend/src/Workspace.tsx
git commit -m "$(cat <<'EOF'
Add public coach profile screen

Bio, price/format/location, weekly availability, recent reviews.
"Записаться" is wired to a no-op — the booking flow is the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Booking flow

**Files:**
- Create: `frontend/src/components/coaches/BookingFlow.tsx`
- Modify: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx` — extend `view` with a `{screen:"booking"}` member
- Modify: `frontend/src/components/coaches/coaches.module.css` — append booking-flow classes

**Interfaces:**
- Consumes: `getCoachOpenSlots`, `createBooking` (Task 1); `CoachPublicProfile` (already fetched by Task 6 — pass it down rather than re-fetching, so the booking confirmation panel can show price/format without a second network call).

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.dateStrip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.dateChip,
.dateChipActive {
  flex-shrink: 0;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: var(--font-display);
  font-weight: 700;
  cursor: pointer;
  text-align: center;
}

.dateChipActive {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-primary-text);
}

.slotGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 8px;
}

.slotButton,
.slotButtonActive {
  padding: 10px 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 700;
  cursor: pointer;
  text-align: center;
}

.slotButtonActive {
  border-color: var(--color-primary);
  background: var(--color-primary-glow);
  color: var(--color-primary);
}

.confirmSummary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.successIcon {
  display: flex;
  justify-content: center;
  color: var(--color-success);
}
```

- [ ] **Step 2: Write `BookingFlow.tsx`**

`getCoachOpenSlots` lives in `api/coaches.ts` and `createBooking` lives in `api/bookings.ts` (Task 1 put them in different files — coach-discovery calls vs. booking calls) — two separate import statements:

```tsx
// frontend/src/components/coaches/BookingFlow.tsx
import { useState } from "react";
import { useEffect } from "react";
import { getCoachOpenSlots } from "../../api/coaches";
import { createBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { CoachPublicProfile, OpenSlot } from "../../types/coach";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

function nextNDays(n: number): Date[] {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function BookingFlow({
  token,
  coach,
  onBack,
  onBooked,
}: {
  token: string;
  coach: CoachPublicProfile;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
}) {
  const days = nextNDays(14);
  const [selectedDay, setSelectedDay] = useState(toDateKey(days[0]));
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [format, setFormat] = useState<"online" | "offline">(coach.offersOnline ? "online" : "offline");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  useEffect(() => {
    setSlots(null);
    setSelectedSlot(null);
    getCoachOpenSlots(token, coach.userId, selectedDay, selectedDay)
      .then(setSlots)
      .catch((err: unknown) => setSlotsError(err instanceof ApiError ? err.message : "Не удалось загрузить слоты"));
  }, [token, coach.userId, selectedDay]);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    setBookError(null);
    try {
      const created = await createBooking(token, {
        coach_user_id: coach.userId,
        starts_at: selectedSlot.startsAt,
        format,
      });
      onBooked(created);
    } catch (err) {
      setBookError(
        err instanceof ApiError && err.code === "slot_unavailable"
          ? "Этот слот уже заняли — выберите другое время."
          : err instanceof ApiError
            ? err.message
            : "Не удалось создать бронь",
      );
      setSelectedSlot(null);
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <button type="button" className={profileStyles.iconButton} onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1 className={profileStyles.pageHeading}>Запись к {coach.fullName}</h1>

        <div className={styles.dateStrip}>
          {days.map((d) => {
            const key = toDateKey(d);
            return (
              <button
                key={key}
                type="button"
                className={key === selectedDay ? styles.dateChipActive : styles.dateChip}
                onClick={() => setSelectedDay(key)}
              >
                {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
              </button>
            );
          })}
        </div>

        {slotsError && <p className={profileStyles.error}>{slotsError}</p>}
        {slots === null && !slotsError && <StateScreen kind="loading" title="Загрузка слотов…" />}
        {slots !== null && slots.length === 0 && <p className={profileStyles.subtitle}>На этот день нет свободных слотов.</p>}
        {slots !== null && slots.length > 0 && (
          <div className={styles.slotGrid}>
            {slots.map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                className={selectedSlot?.startsAt === slot.startsAt ? styles.slotButtonActive : styles.slotButton}
                onClick={() => setSelectedSlot(slot)}
              >
                {new Date(slot.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
        )}

        {coach.offersOnline && coach.offersOffline && (
          <div className={profileStyles.field}>
            <span className={profileStyles.label}>Формат</span>
            <div className={styles.dateStrip}>
              <button
                type="button"
                className={format === "online" ? styles.dateChipActive : styles.dateChip}
                onClick={() => setFormat("online")}
              >
                Онлайн
              </button>
              <button
                type="button"
                className={format === "offline" ? styles.dateChipActive : styles.dateChip}
                onClick={() => setFormat("offline")}
              >
                Очно
              </button>
            </div>
          </div>
        )}

        {selectedSlot && (
          <div className={styles.confirmSummary}>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Тренер</span>
              <span className={profileStyles.rowValue}>{coach.fullName}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Когда</span>
              <span className={profileStyles.rowValue}>
                {new Date(selectedSlot.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Формат</span>
              <span className={profileStyles.rowValue}>{format === "online" ? "Онлайн" : `Очно${coach.location ? `, ${coach.location}` : ""}`}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Стоимость</span>
              <span className={profileStyles.rowValue}>
                {coach.pricePerSession !== null ? `${coach.pricePerSession} ${coach.currency}` : "Не указана"}
              </span>
            </div>
            <p className={profileStyles.subtitle}>После подтверждения бронь появится в вашем календаре.</p>

            {bookError && <p className={profileStyles.error}>{bookError}</p>}

            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleConfirm()} disabled={booking}>
                {booking ? "Бронируем…" : "Подтвердить запись"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Extend `CoachMarketplaceScreen`'s `view` state**

Add `import type { CoachPublicProfile } from "../../types/coach";` to the file's imports if it isn't there yet (it likely already is, from Task 6's list-item typing — check before adding a duplicate).

```tsx
// add imports
import { BookingFlow } from "./BookingFlow";
import type { Booking } from "../../types/booking";

// widen the view union
const [view, setView] = useState<
  | { screen: "list" }
  | { screen: "profile"; coachUserId: string }
  | { screen: "booking"; coach: CoachPublicProfile }
  | { screen: "confirmed"; booking: Booking }
>({ screen: "list" });
```

Add branches:

```tsx
if (view.screen === "booking") {
  return (
    <BookingFlow
      token={token}
      coach={view.coach}
      onBack={() => setView({ screen: "profile", coachUserId: view.coach.userId })}
      onBooked={(booking) => setView({ screen: "confirmed", booking })}
    />
  );
}

if (view.screen === "confirmed") {
  return (
    <div className={teamStyles.screen}>
      <div className={teamStyles.teamCard}>
        <div className={styles.successIcon}>
          <Icon name="check-circle" size={40} />
        </div>
        <h2 className={teamStyles.teamName}>Готово!</h2>
        <p className={teamStyles.teamMeta}>
          Бронь с {view.booking.coachFullName} на{" "}
          {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}{" "}
          подтверждена и добавлена в ваш календарь.
        </p>
        <button type="button" className={teamStyles.addButton} onClick={() => setView({ screen: "list" })}>
          К списку тренеров
        </button>
      </div>
    </div>
  );
}
```

And change `CoachPublicProfileScreen`'s `onBook` prop (currently a no-op from Task 6) — this requires the profile screen to hand its already-fetched `CoachPublicProfile` back up. Simplest fix without re-fetching: change `CoachPublicProfileScreen`'s `onBook` prop type from `() => void` to `(coach: CoachPublicProfile) => void`, and call it as `onClick={() => onBook(profile)}` in its own JSX (the profile is already in scope there via `state.profile`). Then in `CoachMarketplaceScreen`'s `profile` branch: `onBook={(coach) => setView({ screen: "booking", coach })}`.

- [ ] **Step 4: Verify — `tsc` then a full manual booking end-to-end in the browser**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane: open a coach profile, click "Записаться", pick a date with available slots, pick a slot, confirm the summary shows the right coach/time/format/price, confirm the booking, land on the success screen, click through to the list. **Then** open the Календарь tab and confirm the new personal training appears there (this is the proof the backend's training-linkage actually reaches the UI) — this is the single most important check in this whole plan, since it's the one place where a booking becomes visible outside the marketplace screens themselves. Screenshot the confirmation screen and the calendar entry, at both widths.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/coaches/BookingFlow.tsx frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/components/coaches/CoachPublicProfileScreen.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "$(cat <<'EOF'
Add booking flow: date -> slot -> confirm -> success

Confirmation panel restates coach/time/format/location/price and what
happens next, per the spec's booking-UX requirement. Verified the
resulting booking's linked training actually shows up in the existing
Calendar tab.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: My bookings section

**Files:**
- Create: `frontend/src/components/coaches/MyBookingsSection.tsx`
- Modify: `frontend/src/components/profile/ProfileScreen.tsx` — add `showMyBookings` local state
- Modify: `frontend/src/components/profile/ProfileSummary.tsx` — add an entry-point card, any mode (not coach-only — any user can book a coach as an athlete)
- Modify: `frontend/src/components/coaches/coaches.module.css` — append booking-list classes

**Interfaces:**
- Consumes: `listMyBookings` (Task 1).
- Produces: `onReview: (booking: Booking) => void` prop, wired to a no-op in this task — Task 9 fills it in.

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.bookingRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.bookingRow:last-child {
  border-bottom: none;
}

.bookingStatus {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-surface-alt);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: Write `MyBookingsSection.tsx`**

```tsx
// frontend/src/components/coaches/MyBookingsSection.tsx
import { useEffect, useState } from "react";
import { listMyBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

export function MyBookingsSection({ token, onBack, onReview }: { token: string; onBack: () => void; onReview: (booking: Booking) => void }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bookings: Booking[] }>({
    status: "loading",
  });

  useEffect(() => {
    listMyBookings(token)
      .then((bookings) => setState({ status: "ready", bookings }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить брони" }));
  }, [token]);

  if (state.status === "loading") return <StateScreen kind="loading" title="Загрузка броней…" />;
  if (state.status === "error") return <StateScreen kind="error" title="Не удалось загрузить брони" description={state.message} />;

  const upcoming = state.bookings.filter((b) => !b.isCompleted && b.status === "confirmed");
  const past = state.bookings.filter((b) => b.isCompleted);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <button type="button" className={profileStyles.iconButton} onClick={onBack} aria-label="Назад">
          ←
        </button>
        <h1 className={profileStyles.pageHeading}>Мои брони</h1>

        <h2 className={profileStyles.title}>Предстоящие</h2>
        {upcoming.length === 0 && <p className={profileStyles.subtitle}>Нет предстоящих броней.</p>}
        {upcoming.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.coachFullName}</p>
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            <span className={styles.bookingStatus}>Подтверждена</span>
          </div>
        ))}

        <h2 className={profileStyles.title}>Прошедшие</h2>
        {past.length === 0 && <p className={profileStyles.subtitle}>Пока нет прошедших броней.</p>}
        {past.map((b) => (
          <div className={styles.bookingRow} key={b.id}>
            <div>
              <p className={profileStyles.rowValue}>{b.coachFullName}</p>
              <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
            </div>
            {b.hasReview ? (
              <span className={styles.bookingStatus}>Есть отзыв</span>
            ) : (
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => onReview(b)}>
                Оставить отзыв
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ProfileScreen.tsx` and `ProfileSummary.tsx`**

Same pattern as Task 2's marketplace-settings wiring: add `showMyBookings` boolean state and a branch in `ProfileScreen.tsx`; add `onOpenMyBookings: () => void` to `ProfileSummaryProps` and a new card — this one OUTSIDE the `mode === "coach"`/`mode === "player"` conditionals (any user, any mode, can have athlete-side bookings), placed near the existing "Моя статистика" card:

```tsx
<div className={styles.card}>
  <button type="button" className={styles.buttonPrimary} onClick={onOpenMyBookings}>
    <Icon name="calendar" size={17} />
    Мои брони
  </button>
</div>
```

For this task, pass `onReview={() => {}}` from `ProfileScreen.tsx` — Task 9 replaces it.

- [ ] **Step 4: Verify — `tsc` then browser**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane: Профиль → «Мои брони», confirm the booking created in Task 7 appears under «Предстоящие». Screenshot both widths.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/coaches/MyBookingsSection.tsx frontend/src/components/profile/ProfileScreen.tsx frontend/src/components/profile/ProfileSummary.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "$(cat <<'EOF'
Add "Мои брони" section to Profile

Upcoming/past split using the booking's derived is_completed flag.
Available to any user regardless of active mode. Review CTA on
completed, unreviewed bookings is wired to a no-op — next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Review submission

**Files:**
- Create: `frontend/src/components/coaches/ReviewModal.tsx`
- Modify: `frontend/src/components/coaches/MyBookingsSection.tsx` — own the review-modal state, wire `onReview` for real
- Modify: `frontend/src/components/profile/ProfileScreen.tsx` — remove the Task 8 no-op, `MyBookingsSection` no longer needs `onReview` passed from here (it's now self-contained, matching the `TeamsScreen`/`CoachMarketplaceScreen` self-contained pattern established in Tasks 6-7)

**Interfaces:**
- Consumes: `reviewBooking` (Task 1).

- [ ] **Step 1: Append CSS**

```css
/* append to coaches.module.css */

.modalOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 50;
}

.modalCard {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: 20px;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ratingPicker {
  display: flex;
  gap: 6px;
  font-size: 28px;
}

.ratingStar {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-border-strong);
  padding: 0;
  line-height: 1;
}

.ratingStarFilled {
  color: var(--color-warning, #b6790f);
}
```

- [ ] **Step 2: Write `ReviewModal.tsx`**

```tsx
// frontend/src/components/coaches/ReviewModal.tsx
import { useState } from "react";
import { reviewBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

export function ReviewModal({
  token,
  booking,
  onClose,
  onSubmitted,
}: {
  token: string;
  booking: Booking;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await reviewBooking(token, booking.id, { rating, text: text.trim() || null });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить отзыв");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={profileStyles.title}>Отзыв о тренере {booking.coachFullName}</h2>

        <div className={styles.ratingPicker}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= rating ? `${styles.ratingStar} ${styles.ratingStarFilled}` : styles.ratingStar}
              onClick={() => setRating(n)}
              aria-label={`${n} звёзд`}
            >
              ★
            </button>
          ))}
        </div>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Комментарий (необязательно)</span>
          <textarea className={profileStyles.textarea} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Отправка…" : "Отправить отзыв"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onClose} disabled={saving}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `MyBookingsSection.tsx`**

Remove the `onReview` prop entirely (no longer passed from `ProfileScreen.tsx` — self-contained now). Add local state:

```tsx
// add import
import { ReviewModal } from "./ReviewModal";

// inside MyBookingsSection, replace the onReview prop with local state:
const [reviewing, setReviewing] = useState<Booking | null>(null);

// change the "Оставить отзыв" button's onClick from onReview(b) to setReviewing(b)

// after the closing </div> of the main card, before the component's final return-closing tag:
{reviewing && (
  <ReviewModal
    token={token}
    booking={reviewing}
    onClose={() => setReviewing(null)}
    onSubmitted={() => {
      setReviewing(null);
      // Re-fetch so hasReview flips and the button becomes the "Есть отзыв" badge.
      listMyBookings(token).then((bookings) => setState({ status: "ready", bookings }));
    }}
  />
)}
```

- [ ] **Step 4: Update `ProfileScreen.tsx`**

Remove the `onReview={() => {}}` prop from `MyBookingsSection`'s call site — it no longer accepts that prop.

- [ ] **Step 5: Verify — `tsc` then a full manual review end-to-end**

```bash
cd frontend && npx tsc --noEmit
```

In the Browser pane, this needs a **completed** booking, which the real flow can't produce (bookings are always future slots). Two options, pick whichever is faster: (a) directly update the booking's `starts_at` to the past via `docker compose -f docker-compose.dev.yml exec postgres psql ...` against the sandbox DB (`UPDATE bookings SET starts_at = now() - interval '1 day' WHERE id = '<the Task 7 booking's id>';`), or (b) book a slot for "today" if the availability window and current time allow a same-day slot in the past relative to `now()` plus a short wait. Once you have a completed, unreviewed booking: Профиль → «Мои брони» → «Прошедшие» → «Оставить отзыв», pick a star rating, add text, submit, confirm the modal closes and the row now shows «Есть отзыв». Then navigate to that coach's public profile and confirm the review appears in the reviews list and `averageRating`/`reviewCount` updated. Clean up the manual `UPDATE` afterward if you used option (a) (`UPDATE bookings SET starts_at = ... -- restore`, or just leave it, since it's sandbox data). Screenshot the modal and the updated profile.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/coaches/ReviewModal.tsx frontend/src/components/coaches/MyBookingsSection.tsx frontend/src/components/profile/ProfileScreen.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "$(cat <<'EOF'
Add review submission

Star rating + optional text, from "Мои брони" on a completed,
unreviewed booking. Verified end-to-end: submitting a review updates
the coach's public profile rating/review list.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** all 5 frontend screens from the spec are covered (list+filters, public profile, booking flow, my bookings, coach settings incl. availability). The spec's `min_price`/`has_availability_before` filters and coach-side "who booked me" view were already flagged as backend gaps before this plan was written — not addressed here, consistent with the Global Constraints.
- **Placeholder scan:** none found — every code block is the real, final version (an earlier draft of this plan had a deliberately-wrong teaching snippet in Task 7 and an `as never` cast in Task 9; both were removed during self-review in favor of just writing the correct code directly).
- **Type consistency:** `CoachPublicProfile`/`OpenSlot`/`Booking` types (Task 1) are threaded through unchanged from Task 6 (profile) → Task 7 (booking flow, confirmation) → Task 8 (my bookings) → Task 9 (review) — no task redefines or reshapes them.
