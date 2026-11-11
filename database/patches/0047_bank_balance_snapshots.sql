-- 0047: the real balance of the settlement account, entered by a finance administrator (admin «Финансы»; card #37).
-- Additive: one new table, nothing existing is modified. The site cannot see the bank account, so a person copies the balance from the
-- statement; each entry also freezes what the books said at that moment about the trainers' money (their part of the balance is exact:
-- what is waiting for the session + available + in withdrawal requests). Everything else on the account is the platform's own.
-- Append-only: an entry is never edited, a newer one replaces it as the current one.

CREATE TABLE IF NOT EXISTS bank_balance_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    balance_kopecks     BIGINT NOT NULL CHECK (balance_kopecks >= 0),
    trainers_kopecks    BIGINT NOT NULL CHECK (trainers_kopecks >= 0),   -- the trainers' money by the books at the moment of the entry
    note                TEXT CHECK (note IS NULL OR length(note) <= 500),
    entered_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_balance_snapshots_latest_idx ON bank_balance_snapshots (id DESC);
