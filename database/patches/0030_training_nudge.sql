-- "Time to train" re-engagement nudges: a new notification category that is
-- scheduled by the background job (see app/services/nudges.py) for players
-- who haven't opened the app for a while. Opt-out per user, like any other
-- category (notification_preferences), so existing users get it unless they
-- turn it off in Settings.
ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge'));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge'));

-- Speeds up "when/how many nudges did this user get" in the candidate query.
CREATE INDEX notifications_nudges ON notifications(user_id, send_at) WHERE category = 'training_nudge';
