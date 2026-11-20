-- 0053: a finance administrator can give a trainer a personal commission (admin «Финансы» → «Личные комиссии»).
-- Additive: one new table, nothing existing is modified. Like commission_changes (0046) it is an append-only history: a trainer's CURRENT personal
-- percent is his latest row; a row with percent NULL means «back to the general commission», and a trainer with no row at all pays the general one.
-- A payment still freezes the percent it was created with (payments.commission_percent), so a change touches only the payments created after it.

CREATE TABLE IF NOT EXISTS coach_commission_changes (
    id              BIGSERIAL PRIMARY KEY,
    coach_user_id   UUID NOT NULL REFERENCES users(id),
    percent         NUMERIC(5, 2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 50)),  -- NULL: the general commission applies again
    previous        NUMERIC(5, 2) NOT NULL,   -- the percent the trainer paid just before (his personal one, or the general one)
    reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    changed_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_commission_changes_latest_idx ON coach_commission_changes (coach_user_id, id DESC);
