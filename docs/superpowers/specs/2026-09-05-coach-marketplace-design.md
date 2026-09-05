# Coach marketplace — design spec

Date: 2026-09-05
Status: approved by user, pending implementation plan

## Context

SportHelper (product-facing name: SportArena, domain `sportarenamba.ru`) is
currently a closed team-management tool: a coach runs one or more teams,
players belong to a team, and trainings/tasks/matches are scoped to that
team relationship. There is no way for an athlete to find and book a coach
they aren't already teamed up with.

This spec adds a **public coach marketplace**: any athlete can browse
coaches who opt in, compare them, view a public profile, and book a 1:1
paid session — independent of any team membership. This was scoped through
`superpowers:brainstorming` (architectural path) after the initial request
(a generic "sports marketplace" redesign brief from a third-party skill)
turned out to describe a real, wanted product pivot rather than a mismatched
template — confirmed with the user turn-by-turn (see decisions below).

## Goals

- Athletes can search/filter coaches and book a personal training slot with
  one, without needing to belong to that coach's team.
- Coaches control whether they're listed, their price, formats, location
  and weekly availability.
- Reviews build trust: only an athlete who actually attended a session can
  rate/review that coach.
- Reuse the existing Coach entity, the existing personal-training concept,
  and the desktop shell/list patterns already built this session
  (`AppShell`, `SideNav`/`BottomNav`, `.cardGrid`) — this is an additive
  layer, not a parallel product.

## Non-goals (v1)

Confirmed explicitly with the user; revisit only if asked:

- **No in-app payment.** Price is informational; money changes hands
  outside the app. No payment gateway, no refunds/payouts logic.
- **No group sessions.** A booking is always 1:1 (one athlete, one coach,
  one slot). A coach cannot double-book a slot to multiple athletes.
- **No geo-search.** `location` is a free-text field (e.g. city name) with
  exact/substring filtering — no maps, no radius search.
- **No coach-side manual booking confirmation.** A booking is confirmed
  immediately on creation (subject to the slot still being free); a session
  is marked completed automatically once its end time passes, not by
  either party clicking a button. Simplifies the state machine for v1.
- **No review moderation queue.** Reviews publish immediately. Revisit if
  abuse becomes a problem.
- Existing team/player/coach/training/task/match/library functionality is
  **untouched** — this is a strictly additive feature area.

## Data model

All new tables/columns via a new patch file, `database/patches/0019_coach_marketplace.sql`
(next free number after `0018_training_feedback.sql`), following the
project's existing pattern of one patch per feature, FK-ing into earlier
tables rather than reshaping them.

### `coach_profiles` — extended (ALTER TABLE, precedent: `0008_independent_trainings.sql` altering `trainings`)

```sql
ALTER TABLE coach_profiles
    ADD COLUMN is_listed              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN price_per_session      NUMERIC(10, 2),
    ADD COLUMN currency               TEXT NOT NULL DEFAULT 'RUB',
    ADD COLUMN offers_online          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN offers_offline         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location               TEXT,
    ADD COLUMN session_duration_minutes SMALLINT CHECK (session_duration_minutes > 0);
```

`is_listed` defaults to `false` — existing coaches are invisible in the
marketplace until they explicitly opt in from their profile settings.
Nothing changes for a coach who never touches this.

A coach must set at least one of `offers_online`/`offers_offline`,
`price_per_session`, `session_duration_minutes` and have at least one
availability window (see below) before `is_listed` can be set `true` —
enforced in the service layer, not the DB (matches how e.g. team creation
validates elsewhere in this codebase rather than via exotic constraints).

### `coach_availability_templates` — new table

Recurring weekly windows a coach is bookable in.

```sql
CREATE TABLE coach_availability_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id) ON DELETE CASCADE,
    weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Monday
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL CHECK (end_time > start_time),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT no_overlap_per_coach_weekday
        EXCLUDE USING gist (coach_user_id WITH =, weekday WITH =,
                             tsrange(start_time::text, end_time::text) WITH &&)
);

CREATE INDEX coach_availability_by_coach ON coach_availability_templates(coach_user_id);
```

(If the `btree_gist`/`tsrange`-on-`TIME` exclusion constraint proves awkward
in Postgres, the fallback is: no DB-level overlap constraint, validate
non-overlap in the service layer when a coach edits their template — call
this out explicitly during implementation planning, don't block the plan on
it.)

Available slots for a date range are **computed on the fly**: take the
template windows for each weekday in range, cut into
`session_duration_minutes`-sized slots, subtract any slot that already has
a non-cancelled row in `bookings`. No materialized "slots" table, no
background job to keep one populated.

### `bookings` — new table

```sql
CREATE TABLE bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id),
    athlete_user_id UUID NOT NULL REFERENCES users(id),
    starts_at       TIMESTAMPTZ NOT NULL,
    duration_minutes SMALLINT NOT NULL CHECK (duration_minutes > 0),
    format          TEXT NOT NULL CHECK (format IN ('online', 'offline')),
    price_per_session NUMERIC(10, 2),  -- snapshot at booking time; coach's price may change later
    currency        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    training_id     UUID REFERENCES trainings(id),  -- the personal Training this booking created
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bookings_no_double_book UNIQUE (coach_user_id, starts_at)
);

CREATE INDEX bookings_athlete ON bookings(athlete_user_id, starts_at);
CREATE INDEX bookings_coach ON bookings(coach_user_id, starts_at);
```

The `UNIQUE (coach_user_id, starts_at)` constraint is what makes booking
race-safe: two athletes racing to book the same slot both `INSERT`, the
database rejects the second, no explicit locking or materialized-slot
row needed. `status='cancelled'` bookings should NOT be excluded from this
constraint by default in v1 (cancellation is out of scope for the first
cut — see Open Questions) — if cancellation is added later, the unique
constraint needs a `WHERE status != 'cancelled'` partial-index form instead.

**Reuse of `trainings`:** on booking confirmation, create a row in
`trainings` with `type='personal'`, `created_by = athlete_user_id`,
matching `training_date`/`start_time`/`duration_minutes`/`location`
(location = coach's `location` if offline, or e.g. "Онлайн" if online), and
store its id in `bookings.training_id`. This is what makes the booking
show up in the athlete's existing calendar and dashboard for free, with no
new UI needed there. The personal training's `description` can note which
coach it's with.

`status` only ever stores `confirmed` or `cancelled` — there is no
persisted `completed` value and nothing writes one on a timer. "Completed"
is a **derived** presentation state — `status = 'confirmed' AND now() >
starts_at + duration_minutes` — computed wherever it's read (API response,
review-eligibility check), the same style `isTrainingOverdue` already uses
client-side today for trainings, just evaluated server-side here since it
gates whether a review is allowed.

### `coach_reviews` — new table

```sql
CREATE TABLE coach_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings(id),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id),
    athlete_user_id UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_reviews_by_coach ON coach_reviews(coach_user_id);
```

`booking_id UNIQUE` — one review per booking, enforced by the DB. A review
can only be created for a `booking` that: belongs to the requesting athlete,
has `status = 'completed'`, and has no existing review. Average rating and
review count are computed with an aggregate query at read time (coach list
size is small enough that this doesn't need a cached/denormalized column
yet — add one later if it becomes a real query-cost problem).

## API surface (new routes, FastAPI, following existing `app/api/routes/*.py` + repository/service layering)

- `GET /api/coaches` — public marketplace list. Query params: `sport`,
  `location`, `format`, `min_price`/`max_price`, `min_rating`,
  `min_experience_years`, `has_availability_before` (date). Returns cards'
  worth of data including `average_rating`, `review_count`, and the
  earliest open slot (or null).
- `GET /api/coaches/{user_id}` — public coach profile: bio fields, formats,
  price, location, `average_rating`, recent reviews, and this coach's
  availability templates.
- `GET /api/coaches/{user_id}/slots?from=&to=` — computed open slots in a
  date range (the on-the-fly template-minus-bookings computation).
- `POST /api/bookings` — body: `coach_user_id`, `starts_at`, `format`.
  Validates: the slot falls inside the coach's template and isn't already
  booked (the `UNIQUE` constraint is the final backstop, not the only
  check), and `format` is one the coach actually offers
  (`offers_online`/`offers_offline`). On success, creates `bookings` +
  linked `trainings` row transactionally, returns the booking (with its
  `training_id`).
- `GET /api/bookings/me` — the current user's bookings as an athlete, each
  with `status` (`confirmed`/`cancelled`) plus a derived `is_completed`
  flag (see completion rule above) so the client can split upcoming/past
  without recomputing the time math itself.
- `POST /api/bookings/{id}/reviews` — create a review; 403 if not the
  athlete on that booking, 409 if not yet completed (per `is_completed`) or
  already reviewed.
- Coach-side settings — extend the existing coach profile update endpoint
  (`profile.py`) with the new marketplace fields, plus:
  - `GET/PUT /api/coaches/me/availability` — manage weekly template windows.

## Frontend

Builds directly on this session's desktop work — new nav entry, same
`AppShell`/`SideNav`/`BottomNav`, same `.cardGrid` list pattern from
`teams.module.css` (or a sibling module reusing the same class shape), same
design tokens (no new color system).

### Navigation

New top-level tab, **"Тренеры"**, visible to any authenticated user
regardless of player/coach `activeMode` (both an athlete looking for a
coach and a coach browsing colleagues should be able to see it). Added to
`COACH_NAV_ITEMS` and `PLAYER_NAV_ITEMS` in `Workspace.tsx`.

### Screens

1. **Coach list** (`CoachMarketplaceScreen`) — filter bar (sport, location,
   price range, min rating, format, "has availability soon") above a
   `.cardGrid` of coach cards: avatar, name, sport/specialization, short
   bio excerpt, experience, `★ rating (N отзывов)`, price, location,
   format badge(s), earliest open slot, "Профиль" / "Записаться" CTA.
2. **Coach public profile** (`CoachPublicProfileScreen`) — read-only,
   distinct from the existing `CoachProfileForm` (which is for editing
   *your own* profile): bio, specialization, experience, formats, price,
   location, rating summary + review list, weekly schedule, and a date
   picker feeding into...
3. **Booking flow** (`BookingScreen` or a modal sequence) — date → list of
   open slots for that date → confirmation panel restating coach, date/time,
   format, location, price, and what happens next (appears in your
   calendar) → confirm → success state linking to the new training.
4. **My bookings** — a section under the existing Profile tab (not a new
   nav item, avoids nav bloat): upcoming/past list, "Оставить отзыв" CTA on
   completed ones without a review yet.
5. **Coach marketplace settings** — new section inside the existing
   `CoachProfileForm`: listing toggle, price, currency, formats, location,
   session duration, and a weekly-availability editor (day + time-range
   rows, add/remove).

### Booking UX flow

`Тренеры → карточка → профиль тренера → выбрать дату → выбрать слот →
подтверждение (тренер, время, формат, место, цена) → бронь создана →
видна в календаре`. A completed booking surfaces a review prompt from "Мои
брони".

## Notifications (light touch, not a v1 blocker)

`notifications.category` is currently constrained to
(`training_reminder`, `task_deadline`) — adding `booking_confirmed` (to the
coach, on new booking) needs widening that `CHECK` constraint. Reuse the
existing dedup-key/background-sender machinery (`0012_notifications.sql`,
`app/services/notifications.py`) rather than building new delivery
infrastructure. Training reminders already fire for any `trainings` row
regardless of origin, so a booking's linked personal training gets reminder
notifications for free once it exists — no extra work needed there.

## Rollout

- `is_listed` defaults `false`: shipping this feature changes nothing for
  any existing coach or athlete until a coach opts in.
- No migration of existing data needed beyond the new columns/tables.
- Existing team-scoped trainings are unaffected; `trainings.type='personal'`
  already exists and is exercised today by the "personal training" flow in
  `Workspace.tsx`'s overlay — bookings are just another creator of that
  same row shape.

## Open questions for the implementation plan (not blocking spec approval)

- **Cancellation:** v1 as scoped has no cancel action for either party.
  Worth deciding during planning whether a minimal cancel (before the
  session starts, no refund logic since there's no in-app payment) is
  cheap enough to include now rather than as a fast-follow — flag it to
  the user before the plan is finalized.
- **`EXCLUDE USING gist` availability-overlap constraint** may need the
  `btree_gist` extension enabled; confirm it's available on the target
  Postgres image (`postgres:16-alpine`, already in use) during
  implementation, fall back to service-layer validation if not.

## Out of scope / explicit future work

Payments/payouts, group sessions, geo/radius search, coach-initiated slot
blocking for personal reasons (vacation), review moderation/reporting,
booking cancellation and rescheduling, push/SMS reminders beyond the
existing in-app notification channel.
