# Coach listings ("Мои объявления") — design spec

Date: 2026-09-10
Status: approved by user, pending implementation plan

## Context

The coach marketplace (shipped `2026-09-05`, extended with booking
confirmation `2026-09-10`) currently models "being listed" as a single set
of fields on `coach_profiles`: one price, one format, one duration, one
weekly schedule per coach. A coach who offers more than one kind of
session (e.g. individual vs. group, or different sports/durations at
different prices) has no way to represent that — and can't attach a photo
or video to their listing at all, despite the app already having a full
file-upload subsystem (Yandex.Disk-backed, used today for exercise
photos/videos and team logos).

This spec turns "being listed" into **objects a coach manages directly**:
one or more independent, individually-bookable listings ("объявления"),
each with its own price, duration, format, schedule, description, and
optional photo/video. Scoped through `superpowers:brainstorming`
(architectural path); see Decisions below for choices confirmed with the
user turn-by-turn.

## Goals

- A coach can create, edit, and delete multiple listings, each a fully
  independent bookable service (own price/duration/format/schedule).
- A listing can carry a description and one photo + one video, reusing the
  app's existing file-upload infrastructure rather than building a new one.
- The marketplace browse experience becomes listing-centric: one card per
  listing (not per coach), matching how a real listings marketplace reads.
- A coach can never be double-booked across two of their own listings at
  the same time — the existing coach-wide time guard extends across all
  of a coach's listings, not just within one.

## Decisions (confirmed with the user)

- **Listings are independent services**, not multiple "cards" for the same
  offering — each has its own price, duration, format, and weekly
  schedule.
- **Coach-wide double-booking guard preserved.** A booking on any one
  listing blocks that time slot on every other listing the same coach
  owns — enforced the same way as today (`UNIQUE(coach_user_id,
  starts_at)` scoped to active statuses), unchanged in shape, now just
  additionally aware that `starts_at` availability is computed from a
  specific listing's schedule while the collision check still spans the
  whole coach.
- **Old single-listing marketplace fields on `coach_profiles` are fully
  removed**, not kept alongside the new table — one system of record. Data
  is migrated, not discarded.
- **Photo/video: one of each per listing, both optional.** Reuses the
  exact upload pattern already used for exercise photos/videos (`files`
  table, `upload_to_disk`, `AuthenticatedImage`/`AuthenticatedVideo` on the
  frontend) — no new upload infrastructure.
- **Browsing is listing-centric**: the marketplace list shows one card per
  open listing (title, coach name/photo, price, rating, listing photo). A
  coach with 3 listings appears as 3 cards. Clicking a card opens that
  listing's detail/booking page, not a coach-wide profile page.
- **Reviews stay coach-level, not per-listing** — unchanged from the
  existing design. A coach's rating aggregates across all bookings on all
  their listings; every listing detail page shows the same coach rating
  and review list. Splitting reviews per listing wasn't asked for and adds
  real complexity (rating math, review-eligibility checks) for a
  distinction athletes are unlikely to care about at this app's scale.

## Non-goals (this iteration)

- No per-listing reviews (see above).
- No listing photo galleries — exactly one photo slot, not N.
- No draft/preview state for a listing before publishing — `is_listed`
  toggles visibility directly, same as today's coach-level toggle.
- No change to how bookings/confirmation/notifications work beyond adding
  `listing_id` — Tasks from the booking-confirmation feature are otherwise
  untouched.

## Data model

New patch `database/patches/0021_coach_listings.sql` (next free number
after `0020_booking_confirmation.sql`).

### `coach_listings` — new table

```sql
CREATE TABLE coach_listings (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id            UUID NOT NULL REFERENCES coach_profiles(user_id) ON DELETE CASCADE,
    title                    TEXT NOT NULL,
    description              TEXT,
    is_listed                BOOLEAN NOT NULL DEFAULT FALSE,
    price_per_session        NUMERIC(10, 2),
    currency                 TEXT NOT NULL DEFAULT 'RUB',
    offers_online            BOOLEAN NOT NULL DEFAULT FALSE,
    offers_offline           BOOLEAN NOT NULL DEFAULT FALSE,
    location                 TEXT,
    session_duration_minutes SMALLINT CHECK (session_duration_minutes > 0),
    photo_file_id            UUID REFERENCES files(id),
    video_file_id            UUID REFERENCES files(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                TIMESTAMPTZ
);

CREATE INDEX coach_listings_by_coach ON coach_listings(coach_user_id) WHERE deleted_at IS NULL;
```

Same "must have at least one availability window and the required
fields set before `is_listed` can be true" validation as today, just
enforced per-listing instead of per-coach (service layer, not a DB
constraint — matches existing convention).

**Delete is soft** (`deleted_at`), matching the codebase's existing
soft-delete convention (exercises, plans, matches, tasks): a deleted
listing disappears from the coach's management list and the marketplace,
but bookings already made against it keep their history intact.

### `coach_availability_templates` — re-keyed to listings

```sql
ALTER TABLE coach_availability_templates RENAME COLUMN coach_user_id TO listing_id;

ALTER TABLE coach_availability_templates
    DROP CONSTRAINT coach_availability_templates_coach_user_id_fkey;
ALTER TABLE coach_availability_templates
    ADD CONSTRAINT coach_availability_templates_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES coach_listings(id) ON DELETE CASCADE;

DROP INDEX coach_availability_by_coach;
CREATE INDEX coach_availability_by_listing ON coach_availability_templates(listing_id);
```

Each listing gets its own weekly template; the overlap check
(`has_overlap`, service-layer) still applies within one listing's own
windows, not across a coach's other listings — a coach *can* offer two
different listings with overlapping weekly windows (e.g. "available most
weekday evenings" for two different services); the real conflict is only
ever caught at booking time by the coach-wide slot guard below.

### `bookings` — gains `listing_id`

```sql
ALTER TABLE bookings ADD COLUMN listing_id UUID REFERENCES coach_listings(id);
-- backfilled during migration (see Rollout), then:
ALTER TABLE bookings ALTER COLUMN listing_id SET NOT NULL;
```

`coach_user_id` on `bookings` is **unchanged and stays** — it's what the
existing `bookings_no_double_book` partial unique index
(`UNIQUE(coach_user_id, starts_at) WHERE status IN ('pending',
'confirmed')`, from `0020`) keys on, and that's exactly right: the
constraint's job is "this coach's physical time", which doesn't change
just because bookings now also record which specific listing was booked.
No change to that index.

### `coach_reviews` — unchanged

Still keyed on `coach_user_id`. No schema change.

### `files` — gains a `PUBLIC` access level

```sql
ALTER TABLE files DROP CONSTRAINT files_access_level_check;
ALTER TABLE files ADD CONSTRAINT files_access_level_check
    CHECK (access_level IN ('PRIVATE', 'TEAM', 'COACHES_ONLY', 'PUBLIC'));
```

Listing photos/videos are meant to be visible to any athlete browsing the
marketplace, not just teammates or coaches — none of the three existing
levels fit. `GET /api/files/{file_id}` (`backend/app/api/routes/files.py`)
gets one new branch: `access_level == 'PUBLIC'` → any authenticated user
may stream it (still auth-gated, matching every other file in this app —
there is no anonymous file access anywhere, and this doesn't introduce
one). Listing photo/video uploads always write `access_level='PUBLIC'`.

### `coach_profiles` — marketplace fields removed

```sql
ALTER TABLE coach_profiles
    DROP COLUMN is_listed,
    DROP COLUMN price_per_session,
    DROP COLUMN currency,
    DROP COLUMN offers_online,
    DROP COLUMN offers_offline,
    DROP COLUMN location,
    DROP COLUMN session_duration_minutes;
```

`coach_profiles.description` is **kept** — that's the coach's personal
bio, distinct from a listing's own `description` (what this specific
service is).

## API surface

`backend/app/api/routes/coaches.py` is replaced by
`backend/app/api/routes/coach_listings.py`, prefix `/api/coach-listings`.

**Coach-side management:**
- `GET /api/coach-listings/me` — all of the caller's listings (any
  `is_listed` state, excluding soft-deleted).
- `POST /api/coach-listings` — create (title required; everything else
  optional at creation, filled in before listing).
- `PUT /api/coach-listings/{id}` — update; same "listable" validation as
  today (availability + required fields) gates `is_listed=true`.
- `DELETE /api/coach-listings/{id}` — soft-delete; 409 if it has a
  `pending`/`confirmed` booking against it (a coach can't pull a listing
  out from under an active booking — decline or let it complete first).
- `GET/PUT /api/coach-listings/{id}/availability` — per-listing weekly
  template (same shape as today's `/api/coaches/me/availability`, just
  scoped to a listing id in the path instead of implicitly "me").
- `POST /api/coach-listings/{id}/photo`, `POST /api/coach-listings/{id}/video`
  — file upload, following `backend/app/api/routes/exercises.py`'s
  `_upload_exercise_media` pattern exactly (mime/size validation via
  `app.services.uploads`, `files_repo.create_file` with
  `access_level="PUBLIC"`, `entity_type="coach_listing_photo"` /
  `"coach_listing_video"`). Replacing an existing photo/video soft-deletes
  the old `files` row (team-logo style, not exercise style — a listing's
  media should behave like a single canonical slot, not accumulate
  orphaned rows).

**Athlete-side browsing (all require ownership/`is_listed` checks
identical in spirit to today's coach-level ones, just against
`coach_listings`):**
- `GET /api/coach-listings` — open listings, same filter set as today
  (`sport`, `location`, `max_price`, `min_rating`, `format`,
  `min_experience_years` — rating/experience still come from the coach).
  Each card: listing title, price, listing photo, coach name/photo,
  coach rating/review count, next open slot.
- `GET /api/coach-listings/{id}` — full detail: listing
  title/description/photo/video/price/format/duration/location, coach
  name/photo/bio/experience, coach rating + recent reviews, this listing's
  availability.
- `GET /api/coach-listings/{id}/slots?from=&to=` — open slots computed
  from this listing's own template and duration, with the booked-set
  comparison still drawn from **all** of the coach's bookings across every
  listing (so a slot taken via a different listing of the same coach
  correctly disappears here too).

**Booking:** `POST /api/bookings`'s body changes from `coach_user_id` to
`listing_id`; the route looks up the listing (404 if missing/not listed),
derives `coach_user_id`/`price_per_session`/`currency`/`duration_minutes`
from it, and the rest of the confirm/decline/expire flow from the
booking-confirmation feature is unchanged — `bookings.coach_user_id` is
still what `list_pending_for_coach`, the double-booking guard, and the
notification recipient all key on.

## Frontend

- **`MyListingsScreen`** (replaces `CoachMarketplaceSettingsScreen`,
  reached the same way — from Profile, now labeled "Мои объявления"
  instead of "Маркетплейс тренеров"): a list of the coach's listings
  (title, price, listed/unlisted badge, edit/delete), plus "+ Новое
  объявление".
- **`ListingEditScreen`** (new): title, description, price/currency,
  format, duration, location, `FilePicker`-driven photo/video upload
  (`AuthenticatedImage`/`AuthenticatedVideo` for the current one, exactly
  like `ExerciseDetail.tsx`'s pattern), and the existing weekly-availability
  editor UI moved here from the old settings screen, now scoped to one
  listing.
- **`CoachMarketplaceScreen`**: cards become listing cards (title, coach
  name/photo, price, coach rating, listing photo thumbnail).
- **`ListingPublicProfileScreen`** (replaces `CoachPublicProfileScreen`):
  listing description/photo/video up top, coach info/rating/reviews below,
  then the date/slot picker into `BookingFlow`.
- **`BookingFlow`**: takes a listing (not a coach profile) as its subject;
  confirmation summary and the `createBooking` call use `listing_id`.
- **Types/API**: `types/coach.ts` splits into `types/coachListing.ts`
  (`CoachListing` for the manage view, `CoachListingCard`/
  `CoachListingProfile` for public browsing) and `api/coachListings.ts`
  replacing `api/coaches.ts`.

## Rollout

Migration data steps (part of `0021_coach_listings.sql`'s companion
data-migration, run once):
1. For every `coach_profiles` row with `is_listed = true`, insert one
   `coach_listings` row (`title = 'Тренировки'`) carrying over its
   price/currency/format/location/duration/`is_listed`.
2. Re-point each migrated coach's `coach_availability_templates` rows at
   the new listing's id (safe 1:1 — a coach had exactly one schedule
   before this feature, so it maps to exactly one listing).
3. Backfill `bookings.listing_id` by matching `coach_user_id` to the
   listing just created for that coach (also safe 1:1, same reasoning),
   then apply the `NOT NULL` constraint.
4. Drop the old `coach_profiles` marketplace columns.

No athlete/coach-facing behavior changes for a coach who was never
listed. A previously-listed coach's existing listing, schedule, and
booking history carry over unchanged, just now living under a
`coach_listings` row instead of directly on `coach_profiles`.

## Open questions for the implementation plan (not blocking spec approval)

- Whether `DELETE`'s "409 if an active booking exists" check should also
  block on future-dated `confirmed` bookings specifically (not just
  `pending`) — almost certainly yes (a coach shouldn't be able to delete a
  listing out from under a confirmed upcoming session), call this out
  explicitly in the plan rather than leaving it implicit.
- Exact wording/UX for what happens to a listing's `is_listed` toggle when
  a coach has zero availability windows on a *new* listing they haven't
  finished setting up yet — same "availability_required" 409 pattern as
  today, just needs the right listing id in the error path.

## Out of scope / explicit future work

Per-listing reviews, photo galleries (multi-photo), listing drafts/preview
before publish, listing-level cancellation policies, listing analytics
(views/click-through), archiving vs. hard-delete.
