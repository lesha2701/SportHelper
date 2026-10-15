-- Moderation: hiding user content, and user complaints.

-- 1. A file an administrator hid is not served to anybody on the platform (the bytes stay in storage until
--    an administrator deletes them), and can be restored. Why and by whom is recorded.
ALTER TABLE files ADD COLUMN IF NOT EXISTS hidden_at         TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN IF NOT EXISTS hidden_by         UUID REFERENCES users(id);
ALTER TABLE files ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
CREATE INDEX IF NOT EXISTS files_hidden ON files (hidden_at) WHERE hidden_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_by_owner ON files (owner_id) WHERE deleted_at IS NULL;

-- 2. A coach listing hidden by moderation leaves the public catalogue and cannot be booked, independently of the
--    owner's own is_listed switch (the owner cannot undo it).
ALTER TABLE coach_listings ADD COLUMN IF NOT EXISTS moderation_hidden_at TIMESTAMPTZ;
ALTER TABLE coach_listings ADD COLUMN IF NOT EXISTS moderation_hidden_by UUID REFERENCES users(id);
ALTER TABLE coach_listings ADD COLUMN IF NOT EXISTS moderation_reason    TEXT;

-- 3. Complaints from users about a profile, a listing or a public photo/video.
CREATE TABLE IF NOT EXISTS complaints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type    TEXT NOT NULL CHECK (target_type IN ('user', 'listing', 'media')),
    target_id      UUID NOT NULL,
    -- whose content it is (the profile owner, the listing's coach, the file's owner) - to find and group complaints
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason         TEXT NOT NULL CHECK (reason IN ('inappropriate', 'fraud', 'spam', 'false_info', 'other')),
    comment        TEXT CHECK (comment IS NULL OR length(comment) <= 1000),
    status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'rejected')),
    resolution     TEXT CHECK (resolution IS NULL OR length(resolution) <= 1000),
    handled_by     UUID REFERENCES users(id),
    handled_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT complaints_other_needs_comment CHECK (reason <> 'other' OR length(btrim(COALESCE(comment, ''))) >= 3),
    CONSTRAINT complaints_closed_has_handler CHECK (status IN ('new', 'in_progress') OR (handled_by IS NOT NULL AND handled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS complaints_by_status ON complaints (status, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_by_target ON complaints (target_type, target_id);
CREATE INDEX IF NOT EXISTS complaints_by_target_user ON complaints (target_user_id);
-- One person cannot file the same open complaint twice.
CREATE UNIQUE INDEX IF NOT EXISTS complaints_one_open_per_reporter_target
    ON complaints (reporter_id, target_type, target_id) WHERE status IN ('new', 'in_progress');
