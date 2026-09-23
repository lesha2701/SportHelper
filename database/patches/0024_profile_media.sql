-- Custom avatar: overrides the Telegram-supplied photo_url once set. Kept as
-- its own column (not reusing photo_url) since photo_url is overwritten from
-- Telegram on every login — see users_repo.upsert_from_telegram.
ALTER TABLE users ADD COLUMN avatar_file_id UUID REFERENCES files(id);

-- A user's achievement/highlight media gallery — many photos and videos per
-- user, unlike the single-photo/single-video pattern coach_listings uses.
CREATE TABLE profile_media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id     UUID NOT NULL REFERENCES files(id),
    media_type  TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
    caption     TEXT,
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX profile_media_user ON profile_media(user_id, sort_order) WHERE deleted_at IS NULL;
