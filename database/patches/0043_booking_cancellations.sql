-- 0043: cancelling a confirmed booking: the history of cancellations (who, when, why, by which rule, and what was given back).
-- Additive: one new table and its indexes. Nothing existing is modified: the booking keeps the status 'cancelled' that 0020 already
-- allows (until now nothing set it), and the money goes back through the existing refunds (0039), so the ledger is not touched here.

CREATE TABLE IF NOT EXISTS booking_cancellations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- a booking is cancelled at most once
    booking_id          UUID NOT NULL UNIQUE REFERENCES bookings(id),
    cancelled_by        UUID NOT NULL REFERENCES users(id),
    cancelled_by_role   TEXT NOT NULL CHECK (cancelled_by_role IN ('athlete', 'coach')),
    reason              TEXT,
    -- a snapshot at the moment of cancelling: later changes of the booking or of the rule never rewrite what was applied
    session_starts_at   TIMESTAMPTZ NOT NULL,
    hours_before_start  NUMERIC(8, 2) NOT NULL,
    -- 'unpaid'         : nothing was paid, so nothing is returned
    -- 'athlete_early'  : the athlete cancelled early enough (CANCEL_FREE_HOURS or more before the start): returned in full
    -- 'athlete_late'   : the athlete cancelled later: nothing is returned, the trainer keeps the payment
    -- 'coach'          : the trainer cancelled: always returned in full
    policy              TEXT NOT NULL CHECK (policy IN ('unpaid', 'athlete_early', 'athlete_late', 'coach')),
    paid_kopecks        BIGINT NOT NULL DEFAULT 0 CHECK (paid_kopecks >= 0),
    refund_percent      SMALLINT NOT NULL DEFAULT 0 CHECK (refund_percent BETWEEN 0 AND 100),
    refund_kopecks      BIGINT NOT NULL DEFAULT 0 CHECK (refund_kopecks >= 0),
    -- the refund that carries the money back (NULL while there is nothing to return, or before it is created)
    refund_id           UUID REFERENCES refunds(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT booking_cancellations_refund_within_paid CHECK (refund_kopecks <= paid_kopecks),
    CONSTRAINT booking_cancellations_percent_matches_amount CHECK ((refund_percent = 0) = (refund_kopecks = 0)),
    CONSTRAINT booking_cancellations_unpaid_returns_nothing CHECK (policy <> 'unpaid' OR (paid_kopecks = 0 AND refund_kopecks = 0)),
    CONSTRAINT booking_cancellations_late_returns_nothing CHECK (policy <> 'athlete_late' OR refund_kopecks = 0),
    CONSTRAINT booking_cancellations_refund_needs_amount CHECK (refund_id IS NULL OR refund_kopecks > 0)
);
-- one refund belongs to at most one cancellation
CREATE UNIQUE INDEX IF NOT EXISTS booking_cancellations_one_refund ON booking_cancellations (refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_cancellations_by_user ON booking_cancellations (cancelled_by, created_at DESC);
