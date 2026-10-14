-- Run when the web-authentication version is deployed again after a rollback:
-- removes the guard installed by prepare_rollback.sql.
DROP TRIGGER IF EXISTS rollback_guard_notifications ON notifications;
DROP FUNCTION IF EXISTS rollback_guard_notifications();
