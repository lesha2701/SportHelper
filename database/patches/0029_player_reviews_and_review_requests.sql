-- Coaches can review athletes they trained (so other coaches can see how a
-- player behaves before accepting a request), and the athlete gets a
-- "please review your coach" notification once the coach marks the session
-- as conducted.

CREATE TABLE player_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL UNIQUE REFERENCES bookings(id),
    coach_user_id   UUID NOT NULL REFERENCES users(id),
    athlete_user_id UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_reviews_by_athlete ON player_reviews(athlete_user_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested'));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested'));
