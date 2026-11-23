-- 0057: «Подобрать тренера», этап 2 — согласие тренера на подбор и предложения тренерам.
-- Только добавляет: колонки с значениями по умолчанию, одну таблицу и два новых значения в CHECK.

-- Тренер сам включает подбор и принимает условия; версия условий и время согласия сохраняются.
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS accepts_match_offers BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS match_terms_version TEXT;
ALTER TABLE coach_profiles ADD COLUMN IF NOT EXISTS match_terms_accepted_at TIMESTAMPTZ;

-- Заявка, по которой спортсмен выбрал тренера, получает статус «подобрана».
ALTER TABLE coach_match_requests DROP CONSTRAINT IF EXISTS coach_match_requests_status_check;
ALTER TABLE coach_match_requests ADD CONSTRAINT coach_match_requests_status_check
    CHECK (status IN ('new', 'in_progress', 'matched', 'closed', 'canceled'));

CREATE TABLE IF NOT EXISTS coach_match_offers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id            UUID NOT NULL REFERENCES coach_match_requests(id) ON DELETE CASCADE,
    coach_user_id         UUID NOT NULL REFERENCES users(id),
    status                TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'coach_declined', 'coach_accepted', 'athlete_declined', 'athlete_accepted', 'withdrawn')),
    -- Процент платформы за первую тренировку: фиксируется в момент предложения и не меняется (этап 3 применяет его к оплате).
    first_session_percent NUMERIC(5, 2) NOT NULL CHECK (first_session_percent >= 0 AND first_session_percent <= 100),
    terms_version         TEXT NOT NULL,
    admin_message         TEXT CHECK (admin_message IS NULL OR char_length(admin_message) <= 500),
    coach_decline_reason  TEXT CHECK (coach_decline_reason IS NULL OR char_length(coach_decline_reason) <= 500),
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ NOT NULL,
    athlete_expires_at    TIMESTAMPTZ,
    coach_responded_at    TIMESTAMPTZ,
    athlete_responded_at  TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (request_id, coach_user_id)
);
CREATE INDEX IF NOT EXISTS coach_match_offers_coach_idx ON coach_match_offers (coach_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_match_offers_request_idx ON coach_match_offers (request_id);

-- Две новые категории уведомлений (служебные, без переключателя): предложение тренеру и ответ тренера спортсмену.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('training_reminder', 'task_deadline', 'new_training', 'new_match', 'new_task',
                        'booking_requested', 'booking_decided', 'review_requested', 'training_nudge',
                        'payment_update', 'earning_update', 'withdrawal_update', 'finance_admin',
                        'chat_booking', 'chat_team', 'match_offer', 'match_offer_reply'));
