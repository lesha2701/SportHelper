-- 1. Blocking users: temporary or permanent, with a reason, and a history of every block.
--    users.is_banned stays the switch the whole application already checks; banned_until makes a block
--    temporary (the application treats an elapsed one as lifted at once, and the background loop tidies
--    the flag and the history row). user_bans keeps who blocked whom, why, until when, and how it ended.
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE TABLE IF NOT EXISTS user_bans (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_user_id  UUID REFERENCES users(id),
    reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
    banned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ,                       -- NULL = permanent
    lifted_at      TIMESTAMPTZ,
    lifted_by      UUID REFERENCES users(id),         -- NULL when it simply expired
    lift_reason    TEXT,
    lift_kind      TEXT CHECK (lift_kind IN ('manual', 'expired')),
    CONSTRAINT user_bans_expiry_after_start CHECK (expires_at IS NULL OR expires_at > banned_at),
    CONSTRAINT user_bans_lift_consistent CHECK ((lifted_at IS NULL) = (lift_kind IS NULL))
);
CREATE INDEX IF NOT EXISTS user_bans_by_user ON user_bans (user_id, banned_at DESC);
CREATE INDEX IF NOT EXISTS user_bans_open_expiry ON user_bans (expires_at) WHERE lifted_at IS NULL;
-- At most one block is in force per user at any time.
CREATE UNIQUE INDEX IF NOT EXISTS user_bans_one_open ON user_bans (user_id) WHERE lifted_at IS NULL;

-- Existing blocks (set before this table existed) get a history row so nothing is "blocked without a record".
INSERT INTO user_bans (user_id, reason, banned_at)
SELECT id, 'Заблокирован до появления истории блокировок', COALESCE(banned_at, now())
FROM users
WHERE is_banned AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = users.id AND b.lifted_at IS NULL);

-- 2. The administrators' audit trail: a reason and an outcome for every entry, and append-only.
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'success';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_log_result_valid') THEN
        ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_result_valid CHECK (result IN ('success', 'denied', 'failed'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS admin_audit_log_by_target ON admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_by_admin ON admin_audit_log (admin_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION admin_audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_log is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_log_no_update ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();

DROP TRIGGER IF EXISTS admin_audit_log_no_truncate ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_truncate
    BEFORE TRUNCATE ON admin_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_append_only();
