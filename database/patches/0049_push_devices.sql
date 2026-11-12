-- 0049: push notifications (docs/push.md).
-- A device is one installed app that may be sent a push: the token the phone's system gave it (APNs on iPhone, FCM on Android).
-- A token belongs to one phone, so it is unique: when another person signs in on the same phone the row simply moves to them.
CREATE TABLE IF NOT EXISTS push_devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    token        TEXT NOT NULL CHECK (length(token) BETWEEN 8 AND 4096),
    app_version  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS push_devices_by_user ON push_devices (user_id);
