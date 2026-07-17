-- Iteration 10: notification queue + per-category preferences, backing the
-- background asyncio job (reminders, retries — no Redis/Celery).

CREATE TABLE notification_preferences (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL CHECK (category IN ('training_reminder', 'task_deadline')),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, category)
);

-- A missing row means "enabled" (the default) — only deviations are stored.
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        TEXT NOT NULL CHECK (category IN ('training_reminder', 'task_deadline')),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    send_at         TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    -- Stable per (entity, recipient) key so rescheduling (e.g. the coach
    -- moves a training) upserts the existing row instead of creating a
    -- duplicate, and so an already-sent reminder is never resurrected.
    dedup_key       TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);

CREATE INDEX notifications_due ON notifications(status, send_at);
