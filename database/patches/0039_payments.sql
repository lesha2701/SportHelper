-- 0039: payments for confirmed bookings (ЮKassa). Additive: one new table and one new nullable column.

CREATE TABLE IF NOT EXISTS payments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id           UUID NOT NULL REFERENCES bookings(id),
    payer_user_id        UUID NOT NULL REFERENCES users(id),
    provider             TEXT NOT NULL DEFAULT 'yookassa',
    -- NULL for the moment between "we decided to charge" and "the provider answered"
    provider_payment_id  TEXT UNIQUE,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'canceled')),
    amount               NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency             TEXT NOT NULL,
    confirmation_url     TEXT,
    -- Sent to the provider as Idempotence-Key: repeating the call for the same row can never create a second charge.
    idempotence_key      UUID NOT NULL DEFAULT gen_random_uuid(),
    cancellation_reason  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at              TIMESTAMPTZ
);

-- At most one live payment per booking: a booking can be paid once, and a second "pay" click while the first is still open
-- returns the same payment instead of starting another.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_per_booking
    ON payments (booking_id) WHERE status IN ('pending', 'succeeded');
CREATE INDEX IF NOT EXISTS payments_by_booking ON payments (booking_id, created_at DESC);

-- The record of what was accepted by paying (the standard terms), tied to the booking it was accepted for.
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS booking_id UUID;
