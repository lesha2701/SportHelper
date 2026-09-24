-- Lets the website's notification bell track "seen by the user" separately
-- from `status`, which tracks delivery (pending/sent/failed/cancelled) —
-- a 'sent' notification is delivered to Telegram but not yet read in-app.
ALTER TABLE notifications ADD COLUMN read_at TIMESTAMPTZ;

CREATE INDEX notifications_user_feed ON notifications(user_id, send_at DESC) WHERE status != 'cancelled';
