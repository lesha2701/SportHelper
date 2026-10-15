-- Who was active on which day, for DAU / WAU / MAU and activity charts.
--
-- One row per (user, calendar day in UTC): written at most once per user per day by the app (an
-- upsert that only refreshes last_seen_at), never per API request. A day row means "this signed-in
-- person opened or used the site that day" (see POST /api/activity); anonymous visitors have no row.
-- History starts when this table is created - nothing is invented for earlier days.
CREATE TABLE IF NOT EXISTS user_activity_days (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day            DATE NOT NULL,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS user_activity_days_day ON user_activity_days (day);

-- The most recent activity, kept on the user for the admin list ("last seen") and sorting.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_last_active_at ON users (last_active_at DESC NULLS LAST);

-- Seed it from what is already known (the latest session activity); harmless to repeat.
UPDATE users u
SET last_active_at = s.latest
FROM (SELECT user_id, max(last_seen_at) AS latest FROM user_sessions GROUP BY user_id) s
WHERE s.user_id = u.id AND u.last_active_at IS NULL;
