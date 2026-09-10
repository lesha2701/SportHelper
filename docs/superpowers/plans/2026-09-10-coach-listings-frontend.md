# Coach listings frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the frontend to match the already-shipped `coach-listings` backend: a coach manages multiple independent bookable listings (title/description/price/duration/format/schedule/photo/video each) instead of one set of marketplace fields, and athletes browse/book by listing instead of by coach. This unbreaks the "Тренеры" and "Мои объявления" screens, which currently 404 against the deleted `/api/coaches/*` API.

**Architecture:** New `types/coachListing.ts` + `api/coachListings.ts` (additive, mirrors the backend's `CoachListingCardOut`/`CoachListingProfileOut`/`CoachListingOut` shapes exactly). The booking-flow screens (`BookingFlow`, the public profile screen, `CoachMarketplaceScreen`) are rewritten together in one task since they pass state to each other in a tight chain. The coach's own management screen becomes two screens: a list (`MyListingsScreen`) and a per-listing editor (`ListingEditScreen`, new — reuses the existing `FilePicker`/`AuthenticatedImage`/`AuthenticatedVideo` upload pattern already used for exercise media, unchanged). The old `types/coach.ts`/`api/coaches.ts`/`CoachMarketplaceSettingsScreen.tsx`/`CoachPublicProfileScreen.tsx` are deleted only once nothing references them (last task) — TypeScript doesn't error on an orphaned unused file, so they can sit dead for a couple of tasks without breaking `tsc`.

**Tech Stack:** React + TypeScript + CSS Modules, no router (local `useState` view unions), no frontend test framework — verification is `npx tsc --noEmit` per task plus a full live walkthrough in the Browser pane at the end.

**Spec:** [`docs/superpowers/specs/2026-09-10-coach-listings-design.md`](../specs/2026-09-10-coach-listings-design.md) (Frontend section)

## Global Constraints

- Frontend has no automated test framework — verify every task with `docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit` (must be clean, zero errors) and a live check in the Browser pane where the task says to.
- Follow the existing DTO → camelCase mapper pattern exactly (`mapXDto` functions), matching `types/booking.ts`'s and the old `types/coach.ts`'s conventions.
- Reuse `FilePicker`/`AuthenticatedImage`/`AuthenticatedVideo` (`frontend/src/components/shared/*`) unchanged for listing photo/video — do not build new upload UI.
- CSS: keep using the shared `coaches.module.css` module (project convention — one CSS module per feature area, same as `teams.module.css`), add new classes there rather than creating a second file.
- Do not touch `frontend/src/Workspace.tsx` — `CoachMarketplaceScreen` is rewritten in place (same file, same export name, same props), so nothing that imports it needs to change.
- Do not touch backend files — this plan is frontend-only.

---

### Task 1: Types and API client for coach listings

**Files:**
- Create: `frontend/src/types/coachListing.ts`
- Create: `frontend/src/api/coachListings.ts`

**Interfaces:**
- Produces: `CoachListing`/`CoachListingCard`/`CoachListingProfile` types + their DTOs/mappers, `AvailabilityWindow`/`AvailabilityWindowInput`, `OpenSlot`, `CoachListingFilters`, `CoachListingInput`; API functions `createListing`, `listMyListings`, `updateListing`, `deleteListing`, `getListingAvailability`, `replaceListingAvailability`, `uploadListingPhoto`, `uploadListingVideo`, `listListings`, `getListingProfile`, `getListingOpenSlots`. Tasks 2 and 3 consume all of these; nothing consumes them yet in this task, so this is purely additive.

- [ ] **Step 1: Write the types file**

Create `frontend/src/types/coachListing.ts`:

```typescript
// frontend/src/types/coachListing.ts

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

export interface CoachListingDto {
  id: string;
  coach_user_id: string;
  title: string;
  description: string | null;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
  photo_file_id: string | null;
  video_file_id: string | null;
}

export interface CoachListing {
  id: string;
  coachUserId: string;
  title: string;
  description: string | null;
  isListed: boolean;
  pricePerSession: number | null;
  currency: string;
  offersOnline: boolean;
  offersOffline: boolean;
  location: string | null;
  sessionDurationMinutes: number | null;
  photoFileId: string | null;
  videoFileId: string | null;
}

export function mapCoachListingDto(dto: CoachListingDto): CoachListing {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    title: dto.title,
    description: dto.description,
    isListed: dto.is_listed,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    location: dto.location,
    sessionDurationMinutes: dto.session_duration_minutes,
    photoFileId: dto.photo_file_id,
    videoFileId: dto.video_file_id,
  };
}

export interface CoachListingInput {
  title: string;
  description: string | null;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface CoachListingCardDto {
  id: string;
  title: string;
  description: string | null;
  coach_user_id: string;
  coach_full_name: string;
  coach_photo_url: string | null;
  sport: string;
  specialization: string | null;
  experience_years: number | null;
  average_rating: number | null;
  review_count: number;
  price_per_session: number | null;
  currency: string;
  location: string | null;
  offers_online: boolean;
  offers_offline: boolean;
  photo_file_id: string | null;
  next_available_slot: string | null;
}

export interface CoachListingCard {
  id: string;
  title: string;
  description: string | null;
  coachUserId: string;
  coachFullName: string;
  coachPhotoUrl: string | null;
  sport: string;
  specialization: string | null;
  experienceYears: number | null;
  averageRating: number | null;
  reviewCount: number;
  pricePerSession: number | null;
  currency: string;
  location: string | null;
  offersOnline: boolean;
  offersOffline: boolean;
  photoFileId: string | null;
  nextAvailableSlot: string | null;
}

export function mapCoachListingCardDto(dto: CoachListingCardDto): CoachListingCard {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    coachPhotoUrl: dto.coach_photo_url,
    sport: dto.sport,
    specialization: dto.specialization,
    experienceYears: dto.experience_years,
    averageRating: dto.average_rating,
    reviewCount: dto.review_count,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    location: dto.location,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    photoFileId: dto.photo_file_id,
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

export interface CoachListingProfileDto extends CoachListingCardDto {
  coach_description: string | null;
  session_duration_minutes: number | null;
  video_file_id: string | null;
  availability: AvailabilityWindowDto[];
  recent_reviews: CoachReviewDto[];
}

export interface CoachListingProfile extends CoachListingCard {
  coachDescription: string | null;
  sessionDurationMinutes: number | null;
  videoFileId: string | null;
  availability: AvailabilityWindow[];
  recentReviews: CoachReview[];
}

export function mapCoachListingProfileDto(dto: CoachListingProfileDto): CoachListingProfile {
  return {
    ...mapCoachListingCardDto(dto),
    coachDescription: dto.coach_description,
    sessionDurationMinutes: dto.session_duration_minutes,
    videoFileId: dto.video_file_id,
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

export interface CoachListingFilters {
  sport?: string;
  location?: string;
  max_price?: number;
  min_rating?: number;
  format?: "online" | "offline";
  min_experience_years?: number;
}
```

- [ ] **Step 2: Write the API client**

Create `frontend/src/api/coachListings.ts`:

```typescript
// frontend/src/api/coachListings.ts
import { apiRequest, apiUpload } from "./client";
import {
  mapAvailabilityWindowDto,
  mapCoachListingCardDto,
  mapCoachListingDto,
  mapCoachListingProfileDto,
  mapOpenSlotDto,
  type AvailabilityWindow,
  type AvailabilityWindowDto,
  type AvailabilityWindowInput,
  type CoachListing,
  type CoachListingCard,
  type CoachListingCardDto,
  type CoachListingDto,
  type CoachListingFilters,
  type CoachListingInput,
  type CoachListingProfile,
  type CoachListingProfileDto,
  type OpenSlot,
  type OpenSlotDto,
} from "../types/coachListing";

export async function createListing(token: string, input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>("/api/coach-listings", { method: "POST", token, body: input });
  return mapCoachListingDto(dto);
}

export async function listMyListings(token: string): Promise<CoachListing[]> {
  const dtos = await apiRequest<CoachListingDto[]>("/api/coach-listings/me", { token });
  return dtos.map(mapCoachListingDto);
}

export async function updateListing(token: string, listingId: string, input: CoachListingInput): Promise<CoachListing> {
  const dto = await apiRequest<CoachListingDto>(`/api/coach-listings/${listingId}`, { method: "PUT", token, body: input });
  return mapCoachListingDto(dto);
}

export async function deleteListing(token: string, listingId: string): Promise<void> {
  await apiRequest(`/api/coach-listings/${listingId}`, { method: "DELETE", token });
}

export async function getListingAvailability(token: string, listingId: string): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`, { token });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function replaceListingAvailability(
  token: string,
  listingId: string,
  windows: AvailabilityWindowInput[],
): Promise<AvailabilityWindow[]> {
  const dtos = await apiRequest<AvailabilityWindowDto[]>(`/api/coach-listings/${listingId}/availability`, {
    method: "PUT",
    token,
    body: windows,
  });
  return dtos.map(mapAvailabilityWindowDto);
}

export async function uploadListingPhoto(token: string, listingId: string, file: File): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/photo`, { token, formData });
  return mapCoachListingDto(dto);
}

export async function uploadListingVideo(token: string, listingId: string, file: File): Promise<CoachListing> {
  const formData = new FormData();
  formData.append("file", file);
  const dto = await apiUpload<CoachListingDto>(`/api/coach-listings/${listingId}/video`, { token, formData });
  return mapCoachListingDto(dto);
}

function filtersToQuery(filters: CoachListingFilters): string {
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

export async function listListings(token: string, filters: CoachListingFilters = {}): Promise<CoachListingCard[]> {
  const dtos = await apiRequest<CoachListingCardDto[]>(`/api/coach-listings${filtersToQuery(filters)}`, { token });
  return dtos.map(mapCoachListingCardDto);
}

export async function getListingProfile(token: string, listingId: string): Promise<CoachListingProfile> {
  const dto = await apiRequest<CoachListingProfileDto>(`/api/coach-listings/${listingId}`, { token });
  return mapCoachListingProfileDto(dto);
}

export async function getListingOpenSlots(
  token: string,
  listingId: string,
  fromDate: string,
  toDate: string,
): Promise<OpenSlot[]> {
  const dtos = await apiRequest<OpenSlotDto[]>(
    `/api/coach-listings/${listingId}/slots?from_date=${fromDate}&to_date=${toDate}`,
    { token },
  );
  return dtos.map(mapOpenSlotDto);
}
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: clean (these two new files aren't imported anywhere yet, so this just confirms they're internally valid TypeScript).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/coachListing.ts frontend/src/api/coachListings.ts
git commit -m "feat: add types and API client for coach listings"
```

---

### Task 2: Browse → listing profile → booking flow

**Files:**
- Modify: `frontend/src/types/booking.ts` (add `listingId`/`listingTitle` to `Booking`, `listingTitle` to `PendingBooking`, change `BookingInput.coach_user_id` → `listing_id`)
- Modify: `frontend/src/components/coaches/CoachMarketplaceScreen.tsx` (rewrite: listing cards instead of coach cards)
- Create: `frontend/src/components/coaches/ListingPublicProfileScreen.tsx` (replaces `CoachPublicProfileScreen.tsx`, not deleted until Task 5)
- Modify: `frontend/src/components/coaches/BookingFlow.tsx` (rewrite: takes a listing, not a coach)
- Modify: `frontend/src/components/coaches/coaches.module.css` (add listing photo/video classes)

**Interfaces:**
- Consumes: `listListings`, `getListingProfile`, `getListingOpenSlots` (Task 1), `createBooking` (existing, `api/bookings.ts` — its input type changes in this task).
- Produces: `CoachMarketplaceScreen`'s public surface (`{ token: string }` props) is unchanged, so `Workspace.tsx` needs no edit.

- [ ] **Step 1: Update `types/booking.ts`**

Change `BookingDto`, adding `listing_id`/`listing_title` right after `coach_full_name`:

```typescript
export interface BookingDto {
  id: string;
  coach_user_id: string;
  coach_full_name: string;
  listing_id: string | null;
  listing_title: string | null;
  athlete_user_id: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  status: BookingStatus;
  is_completed: boolean;
  training_id: string | null;
  has_review: boolean;
}
```

Change `Booking` the same way:

```typescript
export interface Booking {
  id: string;
  coachUserId: string;
  coachFullName: string;
  listingId: string | null;
  listingTitle: string | null;
  athleteUserId: string;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  status: BookingStatus;
  isCompleted: boolean;
  trainingId: string | null;
  hasReview: boolean;
}
```

Update `mapBookingDto` to pass both through:

```typescript
export function mapBookingDto(dto: BookingDto): Booking {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    listingId: dto.listing_id,
    listingTitle: dto.listing_title,
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
```

Change `BookingInput`:

```typescript
export interface BookingInput {
  listing_id: string;
  starts_at: string;
  format: "online" | "offline";
}
```

Change `PendingBookingDto`/`PendingBooking`/`mapPendingBookingDto`, adding `listing_title`/`listingTitle` right after `id`:

```typescript
export interface PendingBookingDto {
  id: string;
  listing_title: string | null;
  athlete_user_id: string;
  athlete_full_name: string;
  starts_at: string;
  duration_minutes: number;
  format: string;
  price_per_session: number | null;
  currency: string;
  created_at: string;
}

export interface PendingBooking {
  id: string;
  listingTitle: string | null;
  athleteUserId: string;
  athleteFullName: string;
  startsAt: string;
  durationMinutes: number;
  format: "online" | "offline";
  pricePerSession: number | null;
  currency: string;
  createdAt: string;
}

export function mapPendingBookingDto(dto: PendingBookingDto): PendingBooking {
  return {
    id: dto.id,
    listingTitle: dto.listing_title,
    athleteUserId: dto.athlete_user_id,
    athleteFullName: dto.athlete_full_name,
    startsAt: dto.starts_at,
    durationMinutes: dto.duration_minutes,
    format: dto.format as "online" | "offline",
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    createdAt: dto.created_at,
  };
}
```

- [ ] **Step 2: Add listing media CSS classes**

In `frontend/src/components/coaches/coaches.module.css`, add at the end of the file:

```css
.listingCardPhoto {
  width: 100%;
  max-height: 160px;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
}

.listingPhoto {
  width: 100%;
  max-height: 300px;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--color-surface-alt);
  margin: 8px 0;
}

.listingVideo {
  width: 100%;
  border-radius: var(--radius-md);
  background: #000;
  margin: 8px 0;
}
```

- [ ] **Step 3: Create `ListingPublicProfileScreen.tsx`**

Create `frontend/src/components/coaches/ListingPublicProfileScreen.tsx`:

```tsx
// frontend/src/components/coaches/ListingPublicProfileScreen.tsx
import { useEffect, useState } from "react";
import { getListingProfile } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import type { CoachListingProfile } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function ListingPublicProfileScreen({
  token,
  listingId,
  onBack,
  onBook,
}: {
  token: string;
  listingId: string;
  onBack: () => void;
  onBook: (listing: CoachListingProfile) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; listing: CoachListingProfile }
  >({ status: "loading" });

  useEffect(() => {
    setState({ status: "loading" });
    getListingProfile(token, listingId)
      .then((listing) => setState({ status: "ready", listing }))
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Не удалось загрузить объявление";
        setState({ status: "error", message });
      });
  }, [token, listingId]);

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      {state.status === "loading" && <StateScreen kind="loading" title="Загрузка объявления…" />}
      {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить объявление" description={state.message} />}

      {state.status === "ready" && (() => {
        const { listing } = state;
        const formats = [listing.offersOnline && "Онлайн", listing.offersOffline && "Очно"].filter(Boolean).join(" · ");

        return (
          <>
            <div className={profileStyles.card}>
              <div className={styles.profileHero}>
                {listing.coachPhotoUrl ? (
                  <img className={styles.profileAvatarLg} src={listing.coachPhotoUrl} alt="" />
                ) : (
                  <div className={styles.profileAvatarLg}>{listing.coachFullName.charAt(0).toUpperCase()}</div>
                )}
                <div>
                  <h1 className={profileStyles.title}>{listing.title}</h1>
                  <p className={profileStyles.subtitle}>
                    {listing.coachFullName} · {listing.sport}
                    {listing.experienceYears !== null ? ` · ${listing.experienceYears} лет опыта` : ""}
                  </p>
                  {listing.averageRating !== null && (
                    <p className={profileStyles.subtitle}>
                      <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({listing.reviewCount} отзывов)
                    </p>
                  )}
                </div>
              </div>

              {listing.photoFileId && (
                <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={styles.listingPhoto} />
              )}
              {listing.videoFileId && <AuthenticatedVideo token={token} fileId={listing.videoFileId} className={styles.listingVideo} />}

              {listing.description && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowValue}>{listing.description}</span>
                </div>
              )}
              {listing.coachDescription && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>О тренере</span>
                  <span className={profileStyles.rowValue}>{listing.coachDescription}</span>
                </div>
              )}

              <div className={profileStyles.row}>
                <span className={profileStyles.rowLabel}>Цена</span>
                <span className={profileStyles.rowValue}>
                  {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Не указана"}
                  {listing.sessionDurationMinutes ? ` / ${listing.sessionDurationMinutes} мин` : ""}
                </span>
              </div>
              {formats && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Формат</span>
                  <span className={profileStyles.rowValue}>{formats}</span>
                </div>
              )}
              {listing.location && (
                <div className={profileStyles.row}>
                  <span className={profileStyles.rowLabel}>Город</span>
                  <span className={profileStyles.rowValue}>{listing.location}</span>
                </div>
              )}

              <div className={profileStyles.formActions}>
                <button type="button" className={profileStyles.buttonPrimary} onClick={() => onBook(listing)}>
                  Записаться
                </button>
              </div>
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Расписание</h2>
              {listing.availability.length === 0 && <p className={profileStyles.subtitle}>Пока нет доступного времени.</p>}
              {listing.availability.map((w) => (
                <div className={styles.availabilityRow} key={w.id}>
                  <span>{WEEKDAY_LABELS[w.weekday]}</span>
                  <span>
                    {w.startTime.slice(0, 5)} — {w.endTime.slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>

            <div className={profileStyles.card}>
              <h2 className={profileStyles.title}>Отзывы ({listing.reviewCount})</h2>
              {listing.recentReviews.length === 0 && <p className={profileStyles.subtitle}>Пока нет отзывов.</p>}
              {listing.recentReviews.map((review) => (
                <div className={styles.reviewRow} key={review.id}>
                  <div className={styles.reviewHeader}>
                    <span>{review.athleteFirstName}</span>
                    <span className={styles.starRating}>★ {review.rating}</span>
                  </div>
                  {review.text && <p className={styles.reviewText}>{review.text}</p>}
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `BookingFlow.tsx`**

Replace the whole file with:

```tsx
// frontend/src/components/coaches/BookingFlow.tsx
import { useState } from "react";
import { useEffect, useRef } from "react";
import { getListingOpenSlots } from "../../api/coachListings";
import { createBooking } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import type { CoachListingProfile, OpenSlot } from "../../types/coachListing";
import type { Booking } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
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
  listing,
  onBack,
  onBooked,
}: {
  token: string;
  listing: CoachListingProfile;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
}) {
  const days = nextNDays(14);
  const [selectedDay, setSelectedDay] = useState(toDateKey(days[0]));
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [format, setFormat] = useState<"online" | "offline">(listing.offersOnline ? "online" : "offline");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const daySessionIdRef = useRef(0);

  useEffect(() => {
    daySessionIdRef.current += 1;
    setSlots(null);
    setSelectedSlot(null);
    setBookError(null);
    setSlotsError(null);
    getListingOpenSlots(token, listing.id, selectedDay, selectedDay)
      .then(setSlots)
      .catch((err: unknown) => setSlotsError(err instanceof ApiError ? err.message : "Не удалось загрузить слоты"));
  }, [token, listing.id, selectedDay]);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    const dayAtRequestTime = selectedDay;
    const sessionIdAtRequestTime = daySessionIdRef.current;
    setBooking(true);
    setBookError(null);
    try {
      const created = await createBooking(token, {
        listing_id: listing.id,
        starts_at: selectedSlot.startsAt,
        format,
      });
      onBooked(created);
    } catch (err) {
      if (daySessionIdRef.current === sessionIdAtRequestTime) {
        setBookError(
          err instanceof ApiError && err.code === "slot_unavailable"
            ? "Этот слот уже заняли — выберите другое время."
            : err instanceof ApiError
              ? err.message
              : "Не удалось создать бронь",
        );
        setSelectedSlot(null);
      }
      getListingOpenSlots(token, listing.id, dayAtRequestTime, dayAtRequestTime)
        .then((refreshed) => {
          if (daySessionIdRef.current === sessionIdAtRequestTime) {
            setSlots(refreshed);
          }
        })
        .catch(() => {
          /* keep the existing (stale) list rather than losing it on a transient refresh error */
        });
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Запись: {listing.title}</h1>
        <p className={profileStyles.subtitle}>{listing.coachFullName}</p>

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
                {d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" })}
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
                onClick={() => {
                  setSelectedSlot(slot);
                  setBookError(null);
                }}
              >
                {new Date(slot.startsAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
              </button>
            ))}
          </div>
        )}

        {bookError && <p className={profileStyles.error}>{bookError}</p>}

        {listing.offersOnline && listing.offersOffline && (
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
              <span className={profileStyles.rowLabel}>Объявление</span>
              <span className={profileStyles.rowValue}>{listing.title}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Тренер</span>
              <span className={profileStyles.rowValue}>{listing.coachFullName}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Когда</span>
              <span className={profileStyles.rowValue}>
                {new Date(selectedSlot.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
              </span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Формат</span>
              <span className={profileStyles.rowValue}>{format === "online" ? "Онлайн" : `Очно${listing.location ? `, ${listing.location}` : ""}`}</span>
            </div>
            <div className={profileStyles.row}>
              <span className={profileStyles.rowLabel}>Стоимость</span>
              <span className={profileStyles.rowValue}>
                {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Не указана"}
              </span>
            </div>
            <p className={profileStyles.subtitle}>Заявка уйдёт тренеру на подтверждение — она появится в календаре, как только он её примет.</p>

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

- [ ] **Step 5: Rewrite `CoachMarketplaceScreen.tsx`**

Replace the whole file with:

```tsx
// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { useEffect, useState } from "react";
import { listListings } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { ListingPublicProfileScreen } from "./ListingPublicProfileScreen";
import { BookingFlow } from "./BookingFlow";
import type { CoachListingCard, CoachListingFilters, CoachListingProfile } from "../../types/coachListing";
import type { Booking } from "../../types/booking";
import teamStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type View =
  | { screen: "list" }
  | { screen: "profile"; listingId: string }
  | { screen: "booking"; listing: CoachListingProfile }
  | { screen: "confirmed"; booking: Booking };

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; listings: CoachListingCard[] };

function ListingCardView({ token, listing, onOpen }: { token: string; listing: CoachListingCard; onOpen: () => void }) {
  return (
    <button type="button" className={styles.coachCard} onClick={onOpen}>
      <div className={styles.coachCardTop}>
        {listing.coachPhotoUrl ? (
          <img className={styles.coachAvatar} src={listing.coachPhotoUrl} alt="" />
        ) : (
          <div className={styles.coachAvatar}>{listing.coachFullName.charAt(0).toUpperCase()}</div>
        )}
        <div>
          <h3 className={styles.coachName}>{listing.title}</h3>
          <p className={styles.coachMeta}>
            {listing.coachFullName} · {listing.sport}
            {listing.experienceYears !== null ? ` · ${listing.experienceYears} лет опыта` : ""}
          </p>
          {listing.averageRating !== null && (
            <p className={styles.coachMeta}>
              <span className={styles.starRating}>★ {listing.averageRating.toFixed(1)}</span> ({listing.reviewCount})
            </p>
          )}
        </div>
      </div>

      {listing.photoFileId && (
        <AuthenticatedImage token={token} fileId={listing.photoFileId} alt={listing.title} className={styles.listingCardPhoto} />
      )}

      {listing.description && <p className={styles.coachDescription}>{listing.description}</p>}

      <div className={styles.coachFooterRow}>
        <span className={styles.coachPrice}>
          {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена не указана"}
        </span>
        {listing.location && (
          <span className={teamStyles.teamMeta}>
            <Icon name="map-pin" size={13} /> {listing.location}
          </span>
        )}
      </div>
    </button>
  );
}

export function CoachMarketplaceScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [sport, setSport] = useState("");
  const [location, setLocation] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const load = (filters: CoachListingFilters) => {
    setState({ status: "loading" });
    listListings(token, filters)
      .then((listings) => setState({ status: "ready", listings }))
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

  if (view.screen === "profile") {
    return (
      <ListingPublicProfileScreen
        token={token}
        listingId={view.listingId}
        onBack={() => setView({ screen: "list" })}
        onBook={(listing) => setView({ screen: "booking", listing })}
      />
    );
  }

  if (view.screen === "booking") {
    return (
      <BookingFlow
        token={token}
        listing={view.listing}
        onBack={() => setView({ screen: "profile", listingId: view.listing.id })}
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
          <h2 className={teamStyles.teamName}>Заявка отправлена!</h2>
          <p className={teamStyles.teamMeta}>
            Заявка на {new Date(view.booking.startsAt).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}{" "}
            отправлена тренеру {view.booking.coachFullName}. Ждите подтверждения — статус можно посмотреть в «Мои
            брони» в профиле.
          </p>
          <button type="button" className={teamStyles.addButton} onClick={() => setView({ screen: "list" })}>
            К списку тренеров
          </button>
        </div>
      </div>
    );
  }

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
      {state.status === "ready" && state.listings.length === 0 && (
        <StateScreen kind="empty" title="Пока никого нет" description="Объявления появятся здесь, когда тренеры их опубликуют." />
      )}
      {state.status === "ready" && state.listings.length > 0 && (
        <div className={teamStyles.cardGrid}>
          {state.listings.map((listing) => (
            <ListingCardView
              key={listing.id}
              token={token}
              listing={listing}
              onOpen={() => setView({ screen: "profile", listingId: listing.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: clean. (`CoachMarketplaceSettingsScreen.tsx` and `CoachPublicProfileScreen.tsx` are now orphaned — nothing imports the latter anymore since this task's new `ListingPublicProfileScreen.tsx` replaces it in `CoachMarketplaceScreen.tsx`'s import — but an orphaned file with valid TypeScript doesn't fail `tsc`, so this is expected to stay clean. `CoachMarketplaceSettingsScreen.tsx` still imports the old `api/coaches`/`types/coach` internally, which still exist untouched at this point, so it also still compiles on its own.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/booking.ts frontend/src/components/coaches/CoachMarketplaceScreen.tsx frontend/src/components/coaches/ListingPublicProfileScreen.tsx frontend/src/components/coaches/BookingFlow.tsx frontend/src/components/coaches/coaches.module.css
git commit -m "feat: rewrite coach browsing/booking flow to be listing-centric"
```

---

### Task 3: Coach's "Мои объявления" — list + per-listing editor

**Files:**
- Create: `frontend/src/components/coaches/MyListingsScreen.tsx` (replaces `CoachMarketplaceSettingsScreen.tsx` as the screen `ProfileScreen` routes to)
- Create: `frontend/src/components/coaches/ListingEditScreen.tsx`
- Modify: `frontend/src/components/profile/ProfileScreen.tsx` (route to `MyListingsScreen` instead of `CoachMarketplaceSettingsScreen`)
- Modify: `frontend/src/components/profile/ProfileSummary.tsx` (button label "Маркетплейс тренеров" → "Мои объявления")

**Interfaces:**
- Consumes: `createListing`, `listMyListings`, `updateListing`, `deleteListing`, `getListingAvailability`, `replaceListingAvailability`, `uploadListingPhoto`, `uploadListingVideo` (Task 1); `FilePicker`/`AuthenticatedImage`/`AuthenticatedVideo` (existing, unchanged).
- Produces: nothing new consumed by later tasks — this is a self-contained management surface.

- [ ] **Step 1: Create `ListingEditScreen.tsx`**

Create `frontend/src/components/coaches/ListingEditScreen.tsx`:

```tsx
// frontend/src/components/coaches/ListingEditScreen.tsx
import { useEffect, useState } from "react";
import {
  createListing,
  getListingAvailability,
  replaceListingAvailability,
  updateListing,
  uploadListingPhoto,
  uploadListingVideo,
} from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { Icon } from "../shared/Icon";
import { FilePicker } from "../shared/FilePicker";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import type { AvailabilityWindow, CoachListing } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

interface WindowDraft {
  weekday: number;
  startTime: string;
  endTime: string;
}

export function ListingEditScreen({
  token,
  listing: initialListing,
  onBack,
}: {
  token: string;
  listing: CoachListing | null;
  onBack: () => void;
}) {
  const isNew = initialListing === null;
  const [listingId, setListingId] = useState<string | null>(initialListing?.id ?? null);
  const [title, setTitle] = useState(initialListing?.title ?? "");
  const [description, setDescription] = useState(initialListing?.description ?? "");
  const [isListed, setIsListed] = useState(initialListing?.isListed ?? false);
  const [price, setPrice] = useState(initialListing?.pricePerSession?.toString() ?? "");
  const [currency, setCurrency] = useState(initialListing?.currency ?? "RUB");
  const [offersOnline, setOffersOnline] = useState(initialListing?.offersOnline ?? false);
  const [offersOffline, setOffersOffline] = useState(initialListing?.offersOffline ?? false);
  const [location, setLocation] = useState(initialListing?.location ?? "");
  const [duration, setDuration] = useState(initialListing?.sessionDurationMinutes?.toString() ?? "60");
  const [photoFileId, setPhotoFileId] = useState<string | null>(initialListing?.photoFileId ?? null);
  const [videoFileId, setVideoFileId] = useState<string | null>(initialListing?.videoFileId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [windows, setWindows] = useState<WindowDraft[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityLoadError, setAvailabilityLoadError] = useState<string | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);

  useEffect(() => {
    if (listingId === null) return;
    getListingAvailability(token, listingId)
      .then((loaded) =>
        setWindows(
          loaded.map((w: AvailabilityWindow) => ({
            weekday: w.weekday,
            startTime: w.startTime.slice(0, 5),
            endTime: w.endTime.slice(0, 5),
          })),
        ),
      )
      .catch((err: unknown) => setAvailabilityLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить расписание"));
    // Only runs once, for the listing this screen was opened with — a
    // brand-new listing has no id yet at mount time (handled by the
    // listingId===null guard above and re-triggered once handleSave sets it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Укажите название объявления.");
      return;
    }
    if (isListed && (!(offersOnline || offersOffline) || !price || !duration)) {
      setError("Укажите цену, формат и длительность тренировки, прежде чем публиковать.");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      is_listed: isListed,
      price_per_session: price ? Number(price) : null,
      currency,
      offers_online: offersOnline,
      offers_offline: offersOffline,
      location: location.trim() || null,
      session_duration_minutes: duration ? Number(duration) : null,
    };
    try {
      if (listingId === null) {
        const wantedListed = isListed;
        // A brand-new listing can never be created already-listed (no
        // availability could exist yet for a not-yet-created row) — the
        // backend rejects this with its own 409 regardless, so create
        // unlisted first and let the coach publish via a follow-up Save
        // once they've added availability below.
        const created = await createListing(token, { ...payload, is_listed: false });
        setListingId(created.id);
        setIsListed(false);
        if (wantedListed) {
          setError("Объявление создано. Добавьте расписание ниже, затем сохраните ещё раз, чтобы опубликовать.");
        }
      } else {
        await updateListing(token, listingId, payload);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "availability_required"
          ? "Сначала задайте расписание — без него нельзя опубликовать объявление."
          : err instanceof ApiError
            ? err.message
            : "Не удалось сохранить объявление",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAvailability = async () => {
    if (listingId === null) {
      setAvailabilityError("Сначала сохраните объявление.");
      return;
    }
    setAvailabilityError(null);
    setSavingAvailability(true);
    try {
      await replaceListingAvailability(
        token,
        listingId,
        windows.map((w) => ({ weekday: w.weekday, start_time: `${w.startTime}:00`, end_time: `${w.endTime}:00` })),
      );
    } catch (err) {
      setAvailabilityError(
        err instanceof ApiError && err.code === "overlapping_availability"
          ? "Окна пересекаются — поправьте время."
          : err instanceof ApiError
            ? err.message
            : "Не удалось сохранить расписание",
      );
    } finally {
      setSavingAvailability(false);
    }
  };

  const handlePhotoChange = async (file: File) => {
    if (listingId === null) {
      setMediaError("Сначала сохраните объявление.");
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    try {
      const updated = await uploadListingPhoto(token, listingId, file);
      setPhotoFileId(updated.photoFileId);
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : "Не удалось загрузить фото");
    } finally {
      setMediaBusy(false);
    }
  };

  const handleVideoChange = async (file: File) => {
    if (listingId === null) {
      setMediaError("Сначала сохраните объявление.");
      return;
    }
    setMediaBusy(true);
    setMediaError(null);
    try {
      const updated = await uploadListingVideo(token, listingId, file);
      setVideoFileId(updated.videoFileId);
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : "Не удалось загрузить видео");
    } finally {
      setMediaBusy(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>{isNew ? "Новое объявление" : "Редактирование объявления"}</h1>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Название</span>
          <input
            className={profileStyles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Индивидуальные тренировки"
          />
        </label>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Описание</span>
          <textarea className={profileStyles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>

        <div className={styles.toggleRow}>
          <div className={styles.toggleLabel}>
            <span className={styles.toggleTitle}>Показывать в маркетплейсе</span>
            <span className={styles.toggleHint}>Атлеты смогут найти это объявление и записаться</span>
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
          <input className={profileStyles.input} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </label>

        <div className={profileStyles.field}>
          <span className={profileStyles.label}>Формат</span>
          <div className={styles.formatRow}>
            <button type="button" className={offersOnline ? styles.formatChipActive : styles.formatChip} onClick={() => setOffersOnline((v) => !v)}>
              Онлайн
            </button>
            <button type="button" className={offersOffline ? styles.formatChipActive : styles.formatChip} onClick={() => setOffersOffline((v) => !v)}>
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
          <input className={profileStyles.input} type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {listingId !== null && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Фото и видео</h2>
          {mediaError && <p className={profileStyles.error}>{mediaError}</p>}

          {photoFileId && <AuthenticatedImage token={token} fileId={photoFileId} alt={title} className={styles.listingPhoto} />}
          {videoFileId && <AuthenticatedVideo token={token} fileId={videoFileId} className={styles.listingVideo} />}

          <FilePicker
            icon="image"
            label="Выбрать фотографию"
            hint="JPEG, PNG, WEBP или GIF"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onSelect={(file) => void handlePhotoChange(file)}
            disabled={mediaBusy}
          />
          <FilePicker
            icon="video"
            label="Выбрать видео"
            hint="MP4, MOV или WEBM"
            accept="video/mp4,video/quicktime,video/webm"
            onSelect={(file) => void handleVideoChange(file)}
            disabled={mediaBusy}
          />
        </div>
      )}

      {listingId !== null && (
        <div className={profileStyles.card}>
          <h2 className={profileStyles.title}>Недельное расписание</h2>
          <p className={profileStyles.subtitle}>Когда вы обычно свободны — из этого система нарежет слоты для записи.</p>

          {availabilityLoadError ? (
            <p className={profileStyles.error}>
              Не удалось загрузить текущее расписание: {availabilityLoadError}. Сохранение отключено, чтобы случайно не стереть
              существующие окна — обновите страницу и попробуйте снова.
            </p>
          ) : (
            <>
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
                  <button type="button" className={styles.removeRowButton} onClick={() => setWindows(windows.filter((_, j) => j !== i))} aria-label="Удалить">
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
            </>
          )}

          <div className={profileStyles.formActions}>
            <button
              type="button"
              className={profileStyles.buttonPrimary}
              onClick={() => void handleSaveAvailability()}
              disabled={savingAvailability || !!availabilityLoadError}
            >
              {savingAvailability ? "Сохранение…" : "Сохранить расписание"}
            </button>
          </div>
        </div>
      )}

      {listingId === null && (
        <div className={profileStyles.card}>
          <p className={profileStyles.subtitle}>Сохраните объявление, чтобы добавить фото, видео и расписание.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `MyListingsScreen.tsx`**

Create `frontend/src/components/coaches/MyListingsScreen.tsx`:

```tsx
// frontend/src/components/coaches/MyListingsScreen.tsx
import { useEffect, useState } from "react";
import { deleteListing, listMyListings } from "../../api/coachListings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { ListingEditScreen } from "./ListingEditScreen";
import type { CoachListing } from "../../types/coachListing";
import profileStyles from "../profile/profile.module.css";
import sharedStyles from "../teams/teams.module.css";
import styles from "./coaches.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listings: CoachListing[] };

type View = { screen: "list" } | { screen: "edit"; listing: CoachListing | null };

export function MyListingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setState({ status: "loading" });
    listMyListings(token)
      .then((listings) => setState({ status: "ready", listings }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить объявления" }),
      );
  };

  useEffect(load, [token]);

  if (view.screen === "edit") {
    return (
      <ListingEditScreen
        token={token}
        listing={view.listing}
        onBack={() => {
          setView({ screen: "list" });
          load();
        }}
      />
    );
  }

  const handleDelete = async (listingId: string) => {
    setDeleteError(null);
    setDeletingId(listingId);
    try {
      await deleteListing(token, listingId);
      load();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.code === "listing_has_active_booking"
          ? "Нельзя удалить объявление с активной бронью — сначала отклоните заявку или дождитесь завершения тренировки."
          : err instanceof ApiError
            ? err.message
            : "Не удалось удалить объявление",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>Мои объявления</h1>

        {deleteError && <p className={profileStyles.error}>{deleteError}</p>}

        {state.status === "loading" && <StateScreen kind="loading" title="Загрузка объявлений…" />}
        {state.status === "error" && <StateScreen kind="error" title="Не удалось загрузить объявления" description={state.message} />}
        {state.status === "ready" && state.listings.length === 0 && (
          <p className={profileStyles.subtitle}>У вас пока нет объявлений.</p>
        )}
        {state.status === "ready" &&
          state.listings.map((listing) => (
            <div className={styles.bookingRow} key={listing.id}>
              <div>
                <p className={profileStyles.rowValue}>{listing.title}</p>
                <p className={profileStyles.subtitle}>
                  {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена не указана"}
                  {" · "}
                  {listing.isListed ? "Опубликовано" : "Черновик"}
                </p>
              </div>
              <div className={styles.incomingActions}>
                <button
                  type="button"
                  className={profileStyles.buttonSecondary}
                  onClick={() => setView({ screen: "edit", listing })}
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  className={styles.removeRowButton}
                  disabled={deletingId === listing.id}
                  onClick={() => void handleDelete(listing.id)}
                  aria-label="Удалить"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ))}

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => setView({ screen: "edit", listing: null })}>
            <Icon name="plus" size={16} />
            Новое объявление
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `ProfileScreen.tsx`**

In `frontend/src/components/profile/ProfileScreen.tsx`, replace the import:

```tsx
import { CoachMarketplaceSettingsScreen } from "../coaches/CoachMarketplaceSettingsScreen";
```

with:

```tsx
import { MyListingsScreen } from "../coaches/MyListingsScreen";
```

and replace:

```tsx
  if (showMarketplaceSettings) {
    return <CoachMarketplaceSettingsScreen token={token} onBack={() => setShowMarketplaceSettings(false)} />;
  }
```

with:

```tsx
  if (showMarketplaceSettings) {
    return <MyListingsScreen token={token} onBack={() => setShowMarketplaceSettings(false)} />;
  }
```

(the `showMarketplaceSettings` state variable and `onOpenMarketplaceSettings` prop names are left as-is — renaming them is pure churn with no behavior change; only the screen they open changes.)

- [ ] **Step 4: Update the button label in `ProfileSummary.tsx`**

In `frontend/src/components/profile/ProfileSummary.tsx`, change:

```tsx
          <button type="button" className={styles.buttonSecondary} onClick={onOpenMarketplaceSettings}>
            <Icon name="settings" size={17} />
            Маркетплейс тренеров
          </button>
```

to:

```tsx
          <button type="button" className={styles.buttonSecondary} onClick={onOpenMarketplaceSettings}>
            <Icon name="settings" size={17} />
            Мои объявления
          </button>
```

- [ ] **Step 5: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/coaches/MyListingsScreen.tsx frontend/src/components/coaches/ListingEditScreen.tsx frontend/src/components/profile/ProfileScreen.tsx frontend/src/components/profile/ProfileSummary.tsx
git commit -m "feat: add coach listing management (list, create/edit, photo/video, availability)"
```

---

### Task 4: Show which listing a booking belongs to

**Files:**
- Modify: `frontend/src/components/coaches/IncomingBookingsScreen.tsx`
- Modify: `frontend/src/components/coaches/MyBookingsSection.tsx`

**Interfaces:**
- Consumes: `PendingBooking.listingTitle`, `Booking.listingTitle` (Task 2).

- [ ] **Step 1: Update `IncomingBookingsScreen.tsx`**

Change:

```tsx
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              <p className={profileStyles.subtitle}>
                {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
              </p>
            </div>
```

to:

```tsx
            <div>
              <p className={profileStyles.rowValue}>{b.athleteFullName}</p>
              {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
              <p className={profileStyles.subtitle}>
                {formatDate(b.startsAt)} · {b.format === "online" ? "Онлайн" : "Очно"}
              </p>
            </div>
```

(a coach with only one listing still sees it named now — that's fine and arguably clearer than before, not just a multi-listing accommodation.)

- [ ] **Step 2: Update `MyBookingsSection.tsx`**

There are 4 near-identical row blocks (pending/upcoming/past/declinedOrExpired), each currently:

```tsx
                <div>
                  <p className={profileStyles.rowValue}>{b.coachFullName}</p>
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
```

Change **all four** occurrences to:

```tsx
                <div>
                  <p className={profileStyles.rowValue}>{b.coachFullName}</p>
                  {b.listingTitle && <p className={profileStyles.subtitle}>{b.listingTitle}</p>}
                  <p className={profileStyles.subtitle}>{formatDate(b.startsAt)}</p>
                </div>
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/coaches/IncomingBookingsScreen.tsx frontend/src/components/coaches/MyBookingsSection.tsx
git commit -m "feat: show which listing a booking belongs to"
```

---

### Task 5: Retire old marketplace frontend code and verify end-to-end

**Files:**
- Delete: `frontend/src/types/coach.ts`
- Delete: `frontend/src/api/coaches.ts`
- Delete: `frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx`
- Delete: `frontend/src/components/coaches/CoachPublicProfileScreen.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a fully single-system frontend — every coach-marketplace screen goes through `types/coachListing.ts`/`api/coachListings.ts`.

- [ ] **Step 1: Confirm nothing still references the old files**

```bash
grep -rln "from \"../../types/coach\"\|from \"../../api/coaches\"\|CoachMarketplaceSettingsScreen\|CoachPublicProfileScreen" frontend/src
```

Expected: only the 4 files being deleted in this task should appear (and `CoachMarketplaceSettingsScreen.tsx`/`CoachPublicProfileScreen.tsx` matching their own filename/export is expected — the real check is that no *other* file imports them). If any other file shows up, stop and investigate before deleting.

- [ ] **Step 2: Delete the old files**

```bash
git rm frontend/src/types/coach.ts frontend/src/api/coaches.ts frontend/src/components/coaches/CoachMarketplaceSettingsScreen.tsx frontend/src/components/coaches/CoachPublicProfileScreen.tsx
```

- [ ] **Step 3: Type-check**

```bash
docker compose -f docker-compose.dev.yml exec frontend npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Full live verification in the Browser pane**

The dev stack should already be running (`docker compose -f docker-compose.dev.yml`, frontend at `http://localhost:5175`). Use two tabs — one logged in as the default dev user (the coach), one at `http://localhost:5175/?devUser=2` (the athlete, per this app's existing dev two-account convention: `frontend/src/context/AuthContext.tsx` reads `?devUser=2` to log in as the second fixed dev identity instead of the first).

1. **Coach tab** — Профиль → «Мои объявления»: confirm the list loads (empty or showing whatever exists from earlier manual testing this session). Click «Новое объявление», fill in title/price/format/duration, Save (should succeed even unlisted). Add an availability window, save it. Try toggling "Показывать в маркетплейсе" on and saving — confirm it succeeds now that availability exists. Upload a photo (any small JPEG) via the file picker — confirm it appears via `AuthenticatedImage` immediately after upload succeeds.
2. **Coach tab** — create a second listing with a different title/price, publish it too (with its own availability window). Confirm both now show in the "Мои объявления" list.
3. **Athlete tab** — Тренеры: confirm both of the coach's listings appear as separate cards (proving the "card = listing, not card = coach" model), with the photo thumbnail showing on the one that has it. Open one listing's profile — confirm the photo/description/price/schedule render, then book an open slot. Confirm the success screen says "Заявка отправлена!" and names the correct listing/coach.
4. **Coach tab** — Профиль → «Входящие заявки»: confirm the new request appears with the correct listing title next to the athlete's name. Confirm it.
5. **Athlete tab** — Профиль → «Мои брони»: confirm the booking now shows under "Предстоящие" with the listing title displayed.
6. **Coach tab** — delete the *other* (unbooked) listing from "Мои объявления" — confirm it succeeds (204, no active booking). Try deleting the listing that now has a confirmed booking — confirm it's correctly blocked with the "нельзя удалить объявление с активной бронью" message.

Take at least one screenshot confirming the multi-listing marketplace view (step 3) and one confirming the listing title appearing on a booking (step 4 or 5), as proof.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: retire the old single-listing marketplace frontend"
```

---

## Self-Review Notes

- **Spec coverage:** rename "Маркетплейс тренеров" → "Мои объявления" → Task 3; multiple independent listings with their own price/duration/format/schedule → Tasks 2 (browsing) + 3 (management); photo/video upload reusing existing infra → Task 3 (`FilePicker`/`AuthenticatedImage`/`AuthenticatedVideo`, unchanged); listing-centric browsing (card = listing) → Task 2; booking keyed on `listing_id` → Task 2 (`BookingInput`) + rewired `BookingFlow`; listing title visible on both sides of a booking → Task 4. All spec Frontend-section items have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code, not a description of code.
- **Type consistency:** `CoachListing`/`CoachListingCard`/`CoachListingProfile` field names (Task 1) match exactly what `MyListingsScreen`/`ListingEditScreen` (Task 3) and `CoachMarketplaceScreen`/`ListingPublicProfileScreen`/`BookingFlow` (Task 2) read from them (`photoFileId`, `videoFileId`, `coachPhotoUrl`, etc. — no mismatched camelCase). `Booking.listingTitle`/`PendingBooking.listingTitle` (Task 2) are exactly what Task 4 reads. `ListingEditScreen`'s `listing: CoachListing | null` prop matches exactly what `MyListingsScreen`'s `View` union (`{ screen: "edit"; listing: CoachListing | null }`) passes it — no id-only prop requiring a redundant re-fetch.
- **Sequencing safety:** Task 1 is purely additive. Task 2 rewrites the browse/profile/booking chain in one task specifically because `CoachMarketplaceScreen` → `ListingPublicProfileScreen`/`BookingFlow` pass typed state to each other (a listing object, not just an id) — splitting this chain across tasks would leave `tsc` broken mid-plan. Task 3 is independent of Task 2 (different screens, only sharing `coaches.module.css` and Task 1's API client) — the two could in principle run in either order, but Task 2 first matches the plan's numbering. Task 5's deletions are safe only because Tasks 2-3 already replaced every consumer of the old files — verified explicitly via Task 5 Step 1's grep before deleting anything.
