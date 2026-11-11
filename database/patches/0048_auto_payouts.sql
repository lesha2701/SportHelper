-- 0048: automatic payouts (docs/payouts-automation.md).
-- A payout attempt is one try to move a withdrawal's money through a payout provider. The database itself guarantees the points that
-- must never be broken whatever the code does: one live attempt per withdrawal, the same amount as the withdrawal, one provider
-- operation per attempt, and a request paid by the system carries no person who "paid" it.

-- 1. Fingerprint of the recipient (a keyed hash of the phone / account, never the details themselves): lets the rules notice
--    "new requisites" and "the same requisites used by another trainer".
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS details_fingerprint TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS automated BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS withdrawal_requests_by_fingerprint ON withdrawal_requests (details_fingerprint) WHERE details_fingerprint IS NOT NULL;

-- A payout the system made has no administrator who confirmed it.
ALTER TABLE withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_paid_has_proof;
ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_paid_has_proof CHECK (
    status <> 'paid' OR (bank_reference IS NOT NULL AND paid_at IS NOT NULL AND (paid_by IS NOT NULL OR automated) AND paid_amount_kopecks = amount_kopecks)
);

-- 2. Attempts.
CREATE TABLE IF NOT EXISTS payout_attempts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_id      UUID NOT NULL REFERENCES withdrawal_requests(id),
    provider           TEXT NOT NULL,
    -- what the provider is given as the operation's own key: the same request can never become two operations
    idempotency_key    TEXT NOT NULL,
    amount_kopecks     BIGINT NOT NULL CHECK (amount_kopecks > 0),
    -- created: written before the call; sent: the provider took it; succeeded / failed: the provider said so;
    -- unknown: no answer (never re-sent by the system: a person decides after looking at the provider's cabinet)
    status             TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'sent', 'succeeded', 'failed', 'unknown')),
    provider_payout_id TEXT,
    fee_kopecks        BIGINT NOT NULL DEFAULT 0 CHECK (fee_kopecks >= 0),
    error              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ,
    UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS payout_attempts_by_status ON payout_attempts (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payout_attempts_one_live ON payout_attempts (withdrawal_id) WHERE status <> 'failed';
CREATE UNIQUE INDEX IF NOT EXISTS payout_attempts_provider_operation ON payout_attempts (provider, provider_payout_id) WHERE provider_payout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION payout_attempt_matches_withdrawal() RETURNS TRIGGER AS $$
DECLARE expected BIGINT;
BEGIN
    SELECT amount_kopecks INTO expected FROM withdrawal_requests WHERE id = NEW.withdrawal_id;
    IF expected IS NULL OR expected <> NEW.amount_kopecks THEN
        RAISE EXCEPTION 'a payout attempt must carry exactly the amount of its withdrawal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payout_attempts_amount_check ON payout_attempts;
CREATE TRIGGER payout_attempts_amount_check BEFORE INSERT ON payout_attempts FOR EACH ROW EXECUTE FUNCTION payout_attempt_matches_withdrawal();

-- 3. The switch the system itself can throw: on anything unexpected automation stops until a finance administrator resumes it.
CREATE TABLE IF NOT EXISTS payout_automation_state (
    id           SMALLINT PRIMARY KEY CHECK (id = 1),
    halted       BOOLEAN NOT NULL DEFAULT false,
    halted_reason TEXT,
    halted_at    TIMESTAMPTZ,
    resumed_by   UUID REFERENCES users(id),
    resumed_at   TIMESTAMPTZ,
    reconciled_at TIMESTAMPTZ
);
INSERT INTO payout_automation_state (id) VALUES (1) ON CONFLICT DO NOTHING;
