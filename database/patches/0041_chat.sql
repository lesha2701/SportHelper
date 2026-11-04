-- Chats: one per paid personal training (booking) and one per team.
-- The people in a chat are never stored here: for a booking they are its athlete and coach, for a team its current members,
-- so leaving a team (or a cancelled booking) ends access without touching the chat.

CREATE TABLE chat_conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        TEXT NOT NULL CHECK (kind IN ('booking', 'team')),
    booking_id  UUID UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    team_id     UUID UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_conversations_target CHECK (
        (kind = 'booking' AND booking_id IS NOT NULL AND team_id IS NULL) OR
        (kind = 'team'    AND team_id    IS NOT NULL AND booking_id IS NULL)
    )
);

CREATE TABLE chat_messages (
    id               BIGSERIAL PRIMARY KEY,           -- the order of messages and the cursor for "what is new"
    conversation_id  UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id        UUID NOT NULL REFERENCES users(id),
    body             TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
    -- When the file is finally purged (or removed by a moderator) the message stays as a deleted tombstone.
    file_id          UUID REFERENCES files(id) ON DELETE SET NULL,
    attachment_kind  TEXT CHECK (attachment_kind IN ('photo', 'video')),
    -- Sent again by a double click or a retry after a lost answer: the same key can only ever create one message.
    client_key       UUID NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID REFERENCES users(id),
    CONSTRAINT chat_messages_not_empty CHECK (body IS NOT NULL OR file_id IS NOT NULL OR deleted_at IS NOT NULL),
    CONSTRAINT chat_messages_attachment CHECK ((file_id IS NULL) = (attachment_kind IS NULL) OR deleted_at IS NOT NULL),
    CONSTRAINT chat_messages_client_key UNIQUE (conversation_id, sender_id, client_key)
);
CREATE INDEX chat_messages_conversation ON chat_messages (conversation_id, id DESC);
CREATE INDEX chat_messages_file ON chat_messages (file_id) WHERE file_id IS NOT NULL;

-- How far each person has read (unread counters and "one notification per unread streak").
CREATE TABLE chat_reads (
    conversation_id  UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id     BIGINT NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

-- Chat photos and videos are served only to people who may read that chat.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_access_level_check;
ALTER TABLE files ADD CONSTRAINT files_access_level_check
    CHECK (access_level IN ('PRIVATE', 'TEAM', 'COACHES_ONLY', 'PUBLIC', 'CHAT'));

-- Notification categories for new chat messages (each can be switched off in the settings).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin',
                        'chat_booking', 'chat_team'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin',
                        'chat_booking', 'chat_team'));
