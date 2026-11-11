-- 0046: the platform's commission can be changed by a finance administrator (admin «Финансы»; card #38).
-- Additive: one new table, nothing existing is modified. The table is an append-only history: the CURRENT percent is the latest row;
-- with no row at all the percent is PLATFORM_COMMISSION_PERCENT from the environment, so nothing changes until someone sets it.
-- A payment still freezes the percent it was created with (payments.commission_percent), so a change touches only the payments created
-- after it - never the earnings, refunds and payouts that already exist.

CREATE TABLE IF NOT EXISTS commission_changes (
    id           BIGSERIAL PRIMARY KEY,
    percent      NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 50),
    previous     NUMERIC(5, 2),               -- what applied just before (the environment's value for the first change)
    reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    changed_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_changes_latest_idx ON commission_changes (id DESC);
