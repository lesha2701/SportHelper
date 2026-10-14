-- Run this ONCE, against the production database, right before switching the code back to the
-- version that predates web authentication (commit a70ea3d, "AI player analysis, welcome guide ...").
-- It changes no table structure and deletes nothing.
--
-- Why it is needed: people who registered on the website have no Telegram id. The old version
-- sends every notification through Telegram, and a notification addressed to someone without a
-- Telegram chat makes its background loop fail on every pass (blocking everyone else's too).
-- These rows are marked as already handled (they stay visible in the in-app bell), and a trigger
-- keeps doing that for notifications the old version creates while it runs.
--
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--       -v ON_ERROR_STOP=1 < database/rollback/prepare_rollback.sql
--
-- Undo it with database/rollback/finish_roll_forward.sql when going back to the web-auth version.

BEGIN;

UPDATE notifications SET status = 'sent'
WHERE status IN ('pending', 'failed')
  AND user_id IN (SELECT id FROM users WHERE telegram_id IS NULL);

CREATE OR REPLACE FUNCTION rollback_guard_notifications() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'pending' AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND telegram_id IS NULL) THEN
        NEW.status := 'sent';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rollback_guard_notifications ON notifications;
CREATE TRIGGER rollback_guard_notifications
    BEFORE INSERT ON notifications
    FOR EACH ROW EXECUTE FUNCTION rollback_guard_notifications();

COMMIT;
