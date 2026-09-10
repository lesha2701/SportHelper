# Booking confirmation — design spec

Date: 2026-09-10
Status: approved by user, pending implementation plan

## Context

The coach marketplace (shipped `2026-09-05`, see
[`2026-09-05-coach-marketplace-design.md`](2026-09-05-coach-marketplace-design.md))
lets an athlete book a coach's open slot; the booking is confirmed
immediately on creation, subject only to the slot still being free. That
spec's own non-goals explicitly deferred coach-side confirmation to keep
the v1 state machine simple.

This spec adds that confirmation step: a booking now starts as a request
the coach must accept or decline, rather than being accepted automatically.
Scoped through `superpowers:brainstorming` (architectural path) — see
Decisions below for the choices confirmed with the user turn-by-turn.

## Goals

- A coach reviews and explicitly accepts or declines each booking request
  before it becomes a real, calendar-visible session.
- The coach has a dedicated place to see requests waiting on them
  ("Входящие").
- The athlete is told their request needs the coach's confirmation, and is
  notified of the outcome either way.
- A request that never gets a response doesn't lock the slot forever.

## Decisions (confirmed with the user)

- **Who confirms:** the coach approves the athlete's request (not the
  athlete self-confirming, not a two-sided handshake).
- **Slot holding:** the slot is taken as soon as the request is created
  (`pending`), not left open for competing requests. This needs no new
  locking — the existing `UNIQUE (coach_user_id, starts_at)` constraint on
  `bookings` already enforces it regardless of status.
- **Decline reason:** none required. A single "Отклонить" action, no
  comment field.
- **When the linked `Training` is created:** only on confirmation, not on
  request. A pending/declined/expired request must not appear in the
  athlete's calendar as if it were real.
- **Unanswered requests:** auto-decline after **24 hours** via the existing
  background tick, so a non-responsive coach can't permanently lock a slot.
- **Local dev testing:** add a second fixed dev user
  (`POST /api/auth/dev-login-2`) so the full athlete→coach loop can be
  exercised locally under `DEV_AUTH_ENABLED` without a real second Telegram
  account.

## Non-goals (this iteration)

- No decline reason/comment.
- No re-negotiation (coach proposing a different time).
- No push/SMS beyond the existing Telegram notification channel.
- No change to the review flow — it already gates on `is_completed`, which
  is unaffected by the new intermediate statuses (see below).

## Data model

New patch `database/patches/0020_booking_confirmation.sql` (next free
number after `0019_coach_marketplace.sql`).

```sql
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled'));

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE bookings ALTER COLUMN training_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN responded_at TIMESTAMPTZ;

-- The plain UNIQUE(coach_user_id, starts_at) constraint from 0019 blocks
-- ANY second row at that key regardless of status — harmless while every
-- booking stayed 'confirmed' forever, but a real bug now: a declined or
-- expired request would permanently lock its slot, since its row never
-- goes away. Replace it with a partial unique index that only guards the
-- statuses that actually occupy the slot.
ALTER TABLE bookings DROP CONSTRAINT bookings_no_double_book;
CREATE UNIQUE INDEX bookings_no_double_book
    ON bookings (coach_user_id, starts_at)
    WHERE status IN ('pending', 'confirmed');
```

- `status` gains `pending`/`declined`/`expired`; `confirmed`/`cancelled`
  keep their existing meaning (`cancelled` stays unused until a future
  cancellation feature, same as today).
- `training_id` becomes nullable: a `pending` booking has no `Training`
  yet. It's set (and the row is otherwise immutable history) once the
  coach confirms.
- `responded_at` records when the coach acted (confirm/decline) or when
  the sweep auto-declined — used for display ("Отклонено 10.09 в 14:02")
  and to debug the timeout sweep.
- **Double-booking guard, corrected:** a plain `UNIQUE(coach_user_id,
  starts_at)` would block a fresh request for a slot whose only history is
  a `declined`/`expired`/`cancelled` row — the old row never disappears,
  so the constraint would see it as still occupied forever. The migration
  replaces it with a **partial unique index** scoped to `status IN
  ('pending', 'confirmed')`, so only a row that's actually holding the
  slot blocks a new one at the same `(coach, starts_at)`; a new request
  for a freed slot inserts under a fresh `id` and is unaffected by the old
  row's history.

### `compute_open_slots` (repository function, unchanged signature)

Currently excludes a slot if any non-cancelled booking occupies it.
Changes to: exclude a slot if a booking exists with `status IN ('pending',
'confirmed')`; a slot whose only booking is `declined`/`expired`/
`cancelled` is open again.

### Background sweep

New `sweep_expired_bookings` in `app/services/background.py`, following
the existing `sweep_overdue_tasks` shape: every tick, find `bookings`
rows with `status = 'pending'` and `created_at < now() - interval '24
hours'`, set `status = 'expired'`, `responded_at = now()`, and fire the
athlete-facing decline notification (see below). Runs inside `run_tick`
alongside the existing sweeps — no new loop, no new interval setting.

## API surface

All routes in `app/api/routes/bookings.py` unless noted.

- **`POST /api/bookings`** (existing, athlete) — now inserts with
  `status='pending'`, `training_id=NULL`; no `Training` is created here.
  Slot-availability check (via `compute_open_slots`) and the `UNIQUE`
  constraint work exactly as before. Fires `booking_requested` to the
  coach.
- **`GET /api/bookings/coach/pending`** (new, coach) — this coach's
  `pending` bookings, athlete name included, ordered oldest-first.
- **`POST /api/bookings/{id}/confirm`** (new, coach) — 403 if the booking
  isn't this coach's; 409 if `status != 'pending'` (already
  confirmed/declined/expired — handles a double-click or a request that
  expired moments earlier). On success, transactionally creates the
  `Training` (same fields `create_booking` used to set directly:
  `type='personal'`, `created_by=athlete_user_id`, matching
  date/time/duration/location/description) and sets
  `training_id`/`status='confirmed'`/`responded_at=now()`. Fires
  `booking_decided` to the athlete.
- **`POST /api/bookings/{id}/decline`** (new, coach) — same ownership/state
  checks as confirm; sets `status='declined'`, `responded_at=now()`. Fires
  `booking_decided` to the athlete.
- **`GET /api/bookings/me`** (existing, athlete) — unchanged shape, now
  returns rows in any of the 5 statuses; the client groups by status
  rather than the API pre-splitting them (matches how "Мои брони" already
  splits `upcoming`/`past` client-side today).
- **`POST /api/bookings/{id}/reviews`** (existing) — unchanged;
  `is_completed` is still `status == 'confirmed' AND now() > ends_at`, so
  it's naturally never true for `pending`/`declined`/`expired`.
- **`POST /api/auth/dev-login-2`** (new, dev-only, mirrors
  `/api/auth/dev-login`) — logs in as a second fixed dev user
  (`id=900000002`, `username=dev_user_2`), gated the same way behind
  `DEV_AUTH_ENABLED`. Only registered when that flag is on, same as the
  existing dev-login route.

`BookingOut.status` becomes a 5-value literal instead of 2; `is_completed`
computation is unchanged.

## Notifications

Reuses the existing `notifications` table, background sender, and the
per-category preference toggles (now living in the new Settings screen).
Widens `notifications_category_check` / `notification_preferences_category_check`
to add two categories, following the exact pattern
`0017_new_entity_notifications.sql` used to add the last batch:

- **`booking_requested`** → coach, on request creation. "Новая заявка на
  тренировку от {имя атлета}, {дата/время}."
- **`booking_decided`** → athlete, on confirm/decline/expiry (one category,
  text varies by outcome): "Тренер подтвердил тренировку {дата}." /
  "Заявка отклонена." / "Заявка отменена: тренер не ответил вовремя."

Both default enabled (no preference row = enabled, matching
`notifications_repo.is_enabled`'s existing default) and appear
automatically in the Settings screen's notification list once added to
`NOTIFICATION_CATEGORY_LABELS`.

## Frontend

- **`BookingFlow.tsx`** — success screen copy changes from "Бронь
  подтверждена" to "Заявка отправлена — ждите подтверждения тренера."
- **`MyBookingsSection.tsx`** — adds a "Ожидают подтверждения" section
  (status `pending`) above "Предстоящие" (status `confirmed`, not yet
  completed); declined/expired requests get a status badge rather than a
  disappearing act, so the athlete isn't left wondering what happened.
- **Coach "Входящие" screen** (new, e.g. `IncomingBookingsScreen.tsx`) —
  reachable from the coach's profile alongside "Маркетплейс тренеров",
  with a badge showing the pending count. Each row: athlete name,
  date/time, format, "Подтвердить" / "Отклонить" buttons; a row leaves the
  list once actioned.
- **`types/booking.ts`** — `status` becomes a union of the 5 values.
- **`api/bookings.ts`** — adds `listCoachPendingBookings`,
  `confirmBooking`, `declineBooking`.
- **`types/notification.ts`** — adds `booking_requested`/`booking_decided`
  to `NotificationCategory` and their Russian labels.

## Rollout

- Existing `confirmed`/`cancelled` bookings are unaffected — the status
  CHECK widens, it doesn't rewrite any row.
- No backfill needed: `training_id` was always set for pre-existing rows
  (all `confirmed`), so making the column nullable doesn't touch them.
- This changes live behavior for the already-shipped marketplace: a
  booking is no longer instant. Acceptable since the marketplace has no
  real listed coaches/bookings yet (feature just merged, `is_listed`
  defaults false).

## Out of scope / explicit future work

Decline reason/comment, coach counter-proposing a different time, booking
cancellation (still deferred from the original marketplace spec),
configurable auto-decline timeout (hardcoded 24h for now).
