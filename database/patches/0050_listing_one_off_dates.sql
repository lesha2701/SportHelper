-- 0050: one-off dates in a coach listing's schedule.
-- coach_listing_availability holds the weekly windows («every Monday 14:00–16:00»); this table holds the dates a coach is free
-- on just once («on 12 December 18:00–20:00»). Both feed the same open slots. Past dates simply stop being offered.
CREATE TABLE IF NOT EXISTS coach_listing_dates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  UUID NOT NULL REFERENCES coach_listings(id) ON DELETE CASCADE,
    slot_date   DATE NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL CHECK (end_time > start_time),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_listing_dates_by_listing ON coach_listing_dates (listing_id, slot_date);
