-- database/patches/0019_coach_marketplace.sql
-- Coach marketplace: public listing, weekly availability, bookings, reviews.
-- Purely additive — is_listed defaults FALSE, nothing changes for an
-- existing coach or athlete until a coach opts in.

ALTER TABLE coach_profiles
    ADD COLUMN is_listed                BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN price_per_session        NUMERIC(10, 2),
    ADD COLUMN currency                 TEXT NOT NULL DEFAULT 'RUB',
    ADD COLUMN offers_online            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN offers_offline           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN location                 TEXT,
    ADD COLUMN session_duration_minutes SMALLINT CHECK (session_duration_minutes > 0);

-- Recurring weekly windows a coach is bookable in. Overlap between two
-- windows on the same weekday for the same coach is rejected in the
-- repository layer (app/repositories/coach_marketplace.py), not here —
-- keeps this patch free of Postgres extension requirements.
CREATE TABLE coach_availability_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id   UUID NOT NULL REFERENCES coach_profiles(user_id) ON DELETE CASCADE,
    weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Monday .. 6=Sunday
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL CHECK (end_time > start_time),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_availability_by_coach ON coach_availability_templates(coach_user_id);

-- A confirmed booking always has a linked personal Training (created in the
-- same transaction) — that's what makes it show up in the athlete's
-- existing calendar/dashboard for free. training_id is NOT NULL because
-- there is no valid state where a booking exists without one.
CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id       UUID NOT NULL REFERENCES coach_profiles(user_id),
    athlete_user_id     UUID NOT NULL REFERENCES users(id),
    starts_at           TIMESTAMPTZ NOT NULL,
    duration_minutes    SMALLINT NOT NULL CHECK (duration_minutes > 0),
    format              TEXT NOT NULL CHECK (format IN ('online', 'offline')),
    price_per_session   NUMERIC(10, 2),  -- snapshot at booking time
    currency            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    training_id         UUID NOT NULL REFERENCES trainings(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT bookings_no_double_book UNIQUE (coach_user_id, starts_at)
);

CREATE INDEX bookings_athlete ON bookings(athlete_user_id, starts_at);
CREATE INDEX bookings_coach ON bookings(coach_user_id, starts_at);

-- One review per booking, only by the athlete who was on it, only once
-- that booking is (derived-)completed — enforced in the service/route
-- layer, not here.
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
