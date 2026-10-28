-- 0039: payments (ЮKassa), the ledger, trainer earnings, withdrawals and refunds.
-- Additive: new tables, triggers and one nullable column. Nothing existing is modified except the two notification-category
-- CHECKs (widened). Money is stored as integer kopecks everywhere (no floating point).

-- 1. The obligation to pay for a booking (one per booking). Amounts are a SNAPSHOT taken when it is created: later changes of
--    the listing price or of the commission setting never touch it.
CREATE TABLE IF NOT EXISTS payments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id             UUID NOT NULL UNIQUE REFERENCES bookings(id),
    payer_user_id          UUID NOT NULL REFERENCES users(id),
    coach_user_id          UUID NOT NULL REFERENCES users(id),
    currency               TEXT NOT NULL CHECK (currency = 'RUB'),
    gross_kopecks          BIGINT NOT NULL CHECK (gross_kopecks > 0),
    commission_percent     NUMERIC(5, 2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
    platform_fee_kopecks   BIGINT NOT NULL CHECK (platform_fee_kopecks >= 0),
    trainer_kopecks        BIGINT NOT NULL CHECK (trainer_kopecks >= 0),
    status                 TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting', 'paid', 'partially_refunded', 'refunded')),
    paid_at                TIMESTAMPTZ,
    -- refunds asked for (pending + succeeded) and refunds completed; their sum can never exceed what was paid
    refund_reserved_kopecks BIGINT NOT NULL DEFAULT 0,
    refunded_kopecks       BIGINT NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payments_split_adds_up CHECK (platform_fee_kopecks + trainer_kopecks = gross_kopecks),
    CONSTRAINT payments_refund_bounds CHECK (refunded_kopecks >= 0 AND refunded_kopecks <= refund_reserved_kopecks AND refund_reserved_kopecks <= gross_kopecks)
);
CREATE INDEX IF NOT EXISTS payments_by_coach ON payments (coach_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_by_status ON payments (status, created_at DESC);

-- 2. Each try to pay in ЮKassa.
CREATE TABLE IF NOT EXISTS payment_attempts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id           UUID NOT NULL REFERENCES payments(id),
    provider             TEXT NOT NULL DEFAULT 'yookassa',
    provider_payment_id  TEXT UNIQUE,
    status               TEXT NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'pending', 'succeeded', 'duplicate_paid', 'canceled', 'expired')),
    -- Sent to the provider as Idempotence-Key: repeating the same technical request can never create a second charge.
    idempotence_key      UUID NOT NULL DEFAULT gen_random_uuid(),
    confirmation_url     TEXT,
    cancellation_reason  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at              TIMESTAMPTZ,
    last_checked_at      TIMESTAMPTZ,
    check_count          INTEGER NOT NULL DEFAULT 0
);
-- at most one open attempt, and at most one successful one, per payment
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_open ON payment_attempts (payment_id) WHERE status IN ('created', 'pending');
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_success ON payment_attempts (payment_id) WHERE status = 'succeeded';
CREATE INDEX IF NOT EXISTS payment_attempts_to_check ON payment_attempts (last_checked_at) WHERE status IN ('created', 'pending');

CREATE TABLE IF NOT EXISTS payment_events (
    id                  BIGSERIAL PRIMARY KEY,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    source              TEXT NOT NULL,
    event               TEXT NOT NULL,
    provider_object_id  TEXT,
    outcome             TEXT NOT NULL,
    detail              TEXT
);
CREATE INDEX IF NOT EXISTS payment_events_by_object ON payment_events (provider_object_id, received_at DESC);

CREATE TABLE IF NOT EXISTS payment_incidents (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,
    payment_id   UUID REFERENCES payments(id),
    attempt_id   UUID REFERENCES payment_attempts(id),
    detail       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by  UUID REFERENCES users(id),
    resolved_at  TIMESTAMPTZ,
    resolution   TEXT
);
-- the same problem is recorded once while it is open
CREATE UNIQUE INDEX IF NOT EXISTS payment_incidents_one_open ON payment_incidents (kind, payment_id, COALESCE(attempt_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'open';

-- 3. The ledger: double entry, immutable, with a balance per account kept by a trigger.
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL,
    owner_user_id   UUID REFERENCES users(id),
    type            TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'revenue', 'external')),
    normal_side     TEXT NOT NULL CHECK (normal_side IN ('debit', 'credit')),
    balance_kopecks BIGINT NOT NULL DEFAULT 0,
    allow_negative  BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ledger_accounts_no_overdraft CHECK (allow_negative OR balance_kopecks >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_global ON ledger_accounts (code) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_owned ON ledger_accounts (code, owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          TEXT NOT NULL,
    -- One business event = one key = one posting, ever (replays of webhooks/clicks cannot post twice).
    business_key  TEXT NOT NULL UNIQUE,
    description   TEXT,
    payment_id    UUID REFERENCES payments(id),
    booking_id    UUID REFERENCES bookings(id),
    earning_id    UUID,
    withdrawal_id UUID,
    refund_id     UUID,
    created_by    UUID REFERENCES users(id),
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_transactions_by_payment ON ledger_transactions (payment_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  UUID NOT NULL REFERENCES ledger_transactions(id),
    account_id      UUID NOT NULL REFERENCES ledger_accounts(id),
    direction       TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount_kopecks  BIGINT NOT NULL CHECK (amount_kopecks > 0)
);
CREATE INDEX IF NOT EXISTS ledger_entries_by_account ON ledger_entries (account_id, id DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_by_transaction ON ledger_entries (transaction_id);

INSERT INTO ledger_accounts (code, type, normal_side) VALUES
    ('provider_receivable', 'asset', 'debit'),
    ('platform_revenue', 'revenue', 'credit'),
    ('payouts_external', 'external', 'credit')
ON CONFLICT (code) WHERE owner_user_id IS NULL DO NOTHING;

-- Posting an entry moves the account balance (and takes the row lock that serialises concurrent postings).
CREATE OR REPLACE FUNCTION ledger_apply_entry() RETURNS trigger AS $$
DECLARE side TEXT;
BEGIN
    SELECT normal_side INTO side FROM ledger_accounts WHERE id = NEW.account_id;
    UPDATE ledger_accounts
       SET balance_kopecks = balance_kopecks + CASE WHEN NEW.direction = side THEN NEW.amount_kopecks ELSE -NEW.amount_kopecks END
     WHERE id = NEW.account_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_entries_apply ON ledger_entries;
CREATE TRIGGER ledger_entries_apply AFTER INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- Every transaction must balance (checked at commit, so the entries can be inserted one by one).
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'debit'), 0),
           COALESCE(SUM(amount_kopecks) FILTER (WHERE direction = 'credit'), 0)
      INTO d, c FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
    IF d <> c THEN
        RAISE EXCEPTION 'ledger transaction % is not balanced (debit %, credit %)', NEW.transaction_id, d, c
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- A balance can only be moved by posting entries (the update happens inside the entry trigger, i.e. trigger depth 2),
-- and an account can never be deleted.
CREATE OR REPLACE FUNCTION ledger_accounts_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.balance_kopecks := 0;
        RETURN NEW;
    END IF;
    IF pg_trigger_depth() < 2 OR NEW.balance_kopecks IS NULL THEN
        RAISE EXCEPTION 'a ledger balance can only change by posting entries' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.code <> OLD.code OR NEW.type <> OLD.type OR NEW.normal_side <> OLD.normal_side OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
        RAISE EXCEPTION 'ledger accounts are immutable' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_accounts_guard_trg ON ledger_accounts;
CREATE TRIGGER ledger_accounts_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON ledger_accounts
    FOR EACH ROW EXECUTE FUNCTION ledger_accounts_guard();

-- Append-only tables: rows are never edited or removed (a mistake is corrected by a compensating posting).
CREATE OR REPLACE FUNCTION finance_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

-- 4. Earnings of a trainer, one per paid booking.
CREATE TABLE IF NOT EXISTS trainer_earnings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id            UUID NOT NULL UNIQUE REFERENCES payments(id),
    booking_id            UUID NOT NULL UNIQUE REFERENCES bookings(id),
    coach_user_id         UUID NOT NULL REFERENCES users(id),
    gross_kopecks         BIGINT NOT NULL CHECK (gross_kopecks > 0),
    platform_fee_kopecks  BIGINT NOT NULL CHECK (platform_fee_kopecks >= 0),
    trainer_kopecks       BIGINT NOT NULL CHECK (trainer_kopecks >= 0),
    commission_percent    NUMERIC(5, 2) NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'available', 'reversed')),
    reversed_kopecks      BIGINT NOT NULL DEFAULT 0 CHECK (reversed_kopecks >= 0 AND reversed_kopecks <= trainer_kopecks),
    held_reason           TEXT,
    -- When the trainer marked the session as conducted (a self-attestation: it is the START of the release process, not its end).
    session_confirmed_at  TIMESTAMPTZ,
    released_by           UUID REFERENCES users(id),
    released_at           TIMESTAMPTZ,
    release_note          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trainer_earnings_by_coach ON trainer_earnings (coach_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_earnings_by_status ON trainer_earnings (status, created_at);

-- 5. Withdrawals (manual payouts).
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id       UUID NOT NULL REFERENCES users(id),
    amount_kopecks      BIGINT NOT NULL CHECK (amount_kopecks > 0),
    currency            TEXT NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
    status              TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'canceled')),
    method              TEXT NOT NULL CHECK (method IN ('sbp', 'bank_transfer')),
    -- Recipient details are personal data: encrypted, fixed per request, shown in full only to finance admins (audited).
    details_enc         TEXT NOT NULL,
    details_hint        TEXT NOT NULL,
    -- The browser's retry/double-click of the same form carries the same key and cannot create a second request.
    client_key          UUID NOT NULL,
    reviewed_by         UUID REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    processing_by       UUID REFERENCES users(id),
    paid_by             UUID REFERENCES users(id),
    decided_reason      TEXT,
    bank_reference      TEXT,
    paid_amount_kopecks BIGINT,
    paid_at             TIMESTAMPTZ,
    transfer_note       TEXT,
    attention           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (coach_user_id, client_key),
    CONSTRAINT withdrawal_paid_has_proof CHECK (
        status <> 'paid' OR (bank_reference IS NOT NULL AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND paid_amount_kopecks = amount_kopecks)
    )
);
CREATE INDEX IF NOT EXISTS withdrawal_requests_by_coach ON withdrawal_requests (coach_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_by_status ON withdrawal_requests (status, created_at);
-- one bank operation can confirm only one payout
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_bank_reference ON withdrawal_requests (bank_reference) WHERE bank_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS withdrawal_events (
    id              BIGSERIAL PRIMARY KEY,
    withdrawal_id   UUID NOT NULL REFERENCES withdrawal_requests(id),
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    actor_user_id   UUID REFERENCES users(id),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawal_events_by_withdrawal ON withdrawal_events (withdrawal_id, id);

-- 6. Refunds.
CREATE TABLE IF NOT EXISTS refunds (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id                  UUID NOT NULL REFERENCES payments(id),
    attempt_id                  UUID NOT NULL REFERENCES payment_attempts(id),
    amount_kopecks              BIGINT NOT NULL CHECK (amount_kopecks > 0),
    -- 'duplicate': giving back a second, accidental charge of an already paid payment (it was never booked, so no posting)
    kind                        TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'duplicate')),
    -- how the refund splits between the platform's commission and the trainer's share (fixed when requested)
    commission_refund_kopecks   BIGINT NOT NULL CHECK (commission_refund_kopecks >= 0),
    trainer_refund_kopecks      BIGINT NOT NULL CHECK (trainer_refund_kopecks >= 0),
    reason                      TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'pending', 'succeeded', 'failed')),
    provider_refund_id          TEXT UNIQUE,
    idempotence_key             UUID NOT NULL DEFAULT gen_random_uuid(),
    requested_by                UUID NOT NULL REFERENCES users(id),
    failure_reason              TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                TIMESTAMPTZ,
    CONSTRAINT refunds_split_adds_up CHECK (commission_refund_kopecks + trainer_refund_kopecks = amount_kopecks)
);
CREATE INDEX IF NOT EXISTS refunds_by_payment ON refunds (payment_id, created_at);

-- 7. Immutability of the history.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['ledger_transactions', 'ledger_entries', 'withdrawal_events', 'payment_events'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_change', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION finance_append_only()', t || '_no_change', t);
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION finance_append_only()', t || '_no_truncate', t);
    END LOOP;
END $$;

-- 8. What the athlete accepted by paying is tied to the booking.
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS booking_id UUID;

-- 9. Notification categories for the finance events.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin'));
