-- A small WebP copy of selected photos (coach-listing photos, achievement gallery, exercise
-- photos), stored next to the main file and used by lists/cards. NULL for every file uploaded
-- before this existed and for pictures that are already small - readers then simply serve the
-- main file, so nothing about existing rows or URLs changes.
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumb_disk_path TEXT;
