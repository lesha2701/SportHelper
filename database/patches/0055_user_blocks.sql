-- 0055: a person can block another person (App Store guideline 1.2 for user-generated content): the blocker no longer sees the blocked
-- person's chat messages or gets notifications from him, and a personal-training chat between the two stays closed for sending.
-- Additive: one new table. A block is one row; unblocking deletes it. Rows go with either account.
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id);
