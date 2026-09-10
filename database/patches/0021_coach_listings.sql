-- database/patches/0021_coach_listings.sql
-- Coach listings: a coach's marketplace presence moves from single fields
-- on coach_profiles to one-or-more independently bookable listings, each
-- with its own price/duration/schedule/photo/video. Purely additive here —
-- old coach_profiles marketplace columns, coach_availability_templates,
-- and the old /api/coaches/* routes are untouched and keep working; they
-- are retired in a later task once the new coach-listings API fully
-- replaces them. See docs/superpowers/specs/2026-09-10-coach-listings-design.md.

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

CREATE TABLE coach_listing_availability (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  UUID NOT NULL REFERENCES coach_listings(id) ON DELETE CASCADE,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL CHECK (end_time > start_time),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_listing_availability_by_listing ON coach_listing_availability(listing_id);

-- Nullable, permanently — see Global Constraints. Not backed by a
-- NOT NULL constraint; "a new booking always has one" is enforced at the
-- Pydantic/route layer (BookingIn.listing_id is a required field), not here.
ALTER TABLE bookings ADD COLUMN listing_id UUID REFERENCES coach_listings(id);

ALTER TABLE files DROP CONSTRAINT files_access_level_check;
ALTER TABLE files ADD CONSTRAINT files_access_level_check
    CHECK (access_level IN ('PRIVATE', 'TEAM', 'COACHES_ONLY', 'PUBLIC'));

-- One-time data migration: give every coach with meaningful marketplace
-- configuration a matching listing + copy of their weekly schedule, so
-- existing marketplace data isn't orphaned once the new listing-centric API
-- and frontend take over. Deliberately wider than "is_listed = TRUE": a
-- coach who fully configured their listing (price, duration, format, weekly
-- schedule) but toggled is_listed off must not be silently dropped here,
-- since the old source columns/table are removed by a later migration
-- (0022) — this backfill is the only chance to carry that data forward.
-- is_listed is still copied through as-is in the SELECT, so a genuinely
-- unlisted-but-configured coach's new listing correctly starts unlisted too.
INSERT INTO coach_listings (
    coach_user_id, title, is_listed, price_per_session, currency,
    offers_online, offers_offline, location, session_duration_minutes
)
SELECT user_id, 'Тренировки', is_listed, price_per_session, currency,
       offers_online, offers_offline, location, session_duration_minutes
FROM coach_profiles
WHERE is_listed = TRUE
   OR price_per_session IS NOT NULL
   OR session_duration_minutes IS NOT NULL
   OR offers_online = TRUE
   OR offers_offline = TRUE
   OR EXISTS (
        SELECT 1 FROM coach_availability_templates cat
        WHERE cat.coach_user_id = coach_profiles.user_id
      );

INSERT INTO coach_listing_availability (listing_id, weekday, start_time, end_time)
SELECT cl.id, cat.weekday, cat.start_time, cat.end_time
FROM coach_availability_templates cat
JOIN coach_listings cl ON cl.coach_user_id = cat.coach_user_id;

-- Backfill listing_id on existing bookings by matching coach_user_id to
-- the listing just created for that coach (safe 1:1 — a coach had exactly
-- one bookable service before this feature, so every existing booking
-- maps unambiguously to the one listing created for its coach above). Any
-- booking whose coach has no coach_listings row (i.e. the coach was never
-- listed) is left with listing_id = NULL, same as any future gap — this
-- column is nullable exactly for this reason.
UPDATE bookings b
SET listing_id = cl.id
FROM coach_listings cl
WHERE cl.coach_user_id = b.coach_user_id AND b.listing_id IS NULL;
