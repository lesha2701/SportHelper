-- 0054: a trainer can have the «Pro» status (set by an administrator in the user card); players see a Pro mark next to his name.
-- Additive: one column with a default, so every existing trainer stays an ordinary one until an administrator says otherwise.
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE;
