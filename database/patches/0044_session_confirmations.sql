-- 0044: confirming that a booked session took place (docs/session-confirmation.md; TR-03, TR-04).
-- Additive: two new tables and their indexes, nothing existing is modified. A booking without a row here is simply «nothing recorded yet»:
-- before its end it is scheduled, after it the window is open (awaiting), so the bookings made before this patch need no backfill.

CREATE TABLE IF NOT EXISTS session_confirmations (
    booking_id        UUID PRIMARY KEY REFERENCES bookings(id),
    -- 'awaiting'          : the window is open (a row appears once something is recorded, e.g. the coach's mark)
    -- 'confirmed'         : the athlete confirmed, or the coach entered the athlete's one-time code
    -- 'auto_confirmed'    : 48 hours passed after the end without a dispute
    -- 'disputed'          : one side reported a problem (no-show, not conducted…); the earning is frozen until an administrator decides
    -- 'resolved_released' : the administrator gave the money to the trainer
    -- 'resolved_refunded' : the administrator returned the money to the athlete
    state             TEXT NOT NULL DEFAULT 'awaiting'
                      CHECK (state IN ('awaiting', 'confirmed', 'auto_confirmed', 'disputed', 'resolved_released', 'resolved_refunded')),
    -- the coach's «Тренировка проведена»: recorded, but it neither closes the window nor opens the money (TR-06)
    coach_marked_at   TIMESTAMPTZ,
    confirmed_at      TIMESTAMPTZ,
    confirmed_by      UUID REFERENCES users(id),  -- the athlete, or the coach who entered the code; NULL when automatic
    confirmed_method  TEXT CHECK (confirmed_method IN ('athlete', 'code', 'auto')),
    disputed_at       TIMESTAMPTZ,
    disputed_by       UUID REFERENCES users(id),
    disputed_by_role  TEXT CHECK (disputed_by_role IN ('athlete', 'coach')),
    dispute_kind      TEXT CHECK (dispute_kind IN ('athlete_no_show', 'coach_no_show', 'not_conducted', 'other')),
    dispute_text      TEXT CHECK (length(dispute_text) <= 1000),
    resolved_at       TIMESTAMPTZ,
    resolved_by       UUID REFERENCES users(id),
    resolution_note   TEXT CHECK (length(resolution_note) <= 1000),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a closed window says when, how and (unless automatic) by whom
    CONSTRAINT session_confirmations_confirmed_complete CHECK (
        state NOT IN ('confirmed', 'auto_confirmed') OR (confirmed_at IS NOT NULL AND confirmed_method IS NOT NULL)),
    CONSTRAINT session_confirmations_auto_is_auto CHECK (
        (state = 'auto_confirmed') = (confirmed_method IS NOT DISTINCT FROM 'auto')),
    CONSTRAINT session_confirmations_who_confirmed CHECK (
        confirmed_method IS NULL OR ((confirmed_method = 'auto') = (confirmed_by IS NULL))),
    -- confirming and disputing exclude each other: what was recorded first holds
    CONSTRAINT session_confirmations_confirmed_or_disputed CHECK (confirmed_at IS NULL OR disputed_at IS NULL),
    CONSTRAINT session_confirmations_dispute_complete CHECK (
        state NOT IN ('disputed', 'resolved_released', 'resolved_refunded')
        OR (disputed_at IS NOT NULL AND disputed_by IS NOT NULL AND disputed_by_role IS NOT NULL AND dispute_kind IS NOT NULL)),
    CONSTRAINT session_confirmations_resolution_complete CHECK (
        (state IN ('resolved_released', 'resolved_refunded')) = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
-- the administrator's queue of disputes
CREATE INDEX IF NOT EXISTS session_confirmations_open_disputes ON session_confirmations (disputed_at) WHERE state = 'disputed';

-- The athlete's one-time code for an in-person session: the athlete shows it, the coach enters it (TR-04, TR-07, TR-08).
-- Only a hash is kept, so a code is shown once, when it is issued; asking again issues a new one and the old one stops working.
CREATE TABLE IF NOT EXISTS session_codes (
    booking_id    UUID PRIMARY KEY REFERENCES bookings(id),  -- one live code per booking
    code_hash     TEXT NOT NULL CHECK (length(code_hash) = 64),  -- HMAC-SHA256, hex
    expires_at    TIMESTAMPTZ NOT NULL,
    attempts      SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),  -- wrong entries of THIS code
    issued_count  SMALLINT NOT NULL DEFAULT 1 CHECK (issued_count >= 1),  -- how many codes the booking has had (a limit against guessing by reissuing)
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at   TIMESTAMPTZ,
    verified_by   UUID REFERENCES users(id),
    CONSTRAINT session_codes_verified_complete CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
    CONSTRAINT session_codes_expires_after_issue CHECK (expires_at > issued_at)
);
