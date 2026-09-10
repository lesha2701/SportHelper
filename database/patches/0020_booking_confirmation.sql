-- database/patches/0020_booking_confirmation.sql
-- Adds a coach-confirmation step to bookings: a request now starts
-- 'pending' and only becomes 'confirmed' (and gets its linked Training)
-- once the coach acts. See docs/superpowers/specs/2026-09-10-booking-confirmation-design.md.

ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled'));

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE bookings ALTER COLUMN training_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN responded_at TIMESTAMPTZ;

-- The plain UNIQUE(coach_user_id, starts_at) constraint from 0019 blocks ANY
-- second row at that key regardless of status — harmless while every
-- booking stayed 'confirmed' forever, but a real bug now: a declined or
-- expired request would permanently lock its slot, since its row never
-- goes away. Replace it with a partial unique index that only guards the
-- statuses that actually occupy the slot.
ALTER TABLE bookings DROP CONSTRAINT bookings_no_double_book;
CREATE UNIQUE INDEX bookings_no_double_book
    ON bookings (coach_user_id, starts_at)
    WHERE status IN ('pending', 'confirmed');

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task', 'booking_requested', 'booking_decided'));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task', 'booking_requested', 'booking_decided'));
