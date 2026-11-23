-- 0056: подбор тренера, этап 1: анкета спортсмена и очередь заявок для администраторов.
-- Обязателен только вид спорта; остальное человек заполняет по желанию (чем больше, тем точнее подбор). Возраста и других данных, которых
-- на платформе нет, в анкете нет: среди спортсменов бывают дети.
CREATE TABLE IF NOT EXISTS coach_match_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sport         TEXT NOT NULL CHECK (char_length(sport) BETWEEN 2 AND 100),
    goal          TEXT CHECK (goal IS NULL OR char_length(goal) BETWEEN 1 AND 1000),
    level         TEXT CHECK (level IS NULL OR level IN ('beginner', 'amateur', 'advanced', 'pro')),
    format        TEXT CHECK (format IS NULL OR format IN ('online', 'offline', 'any')),
    city          TEXT CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 100),
    budget_min    NUMERIC(10, 2) CHECK (budget_min IS NULL OR budget_min >= 0),
    budget_max    NUMERIC(10, 2) CHECK (budget_max IS NULL OR budget_max >= 0),
    currency      TEXT NOT NULL DEFAULT 'RUB' CHECK (char_length(currency) = 3),
    -- когда может заниматься: дни недели (0 = понедельник … 6 = воскресенье, как в окнах тренера), время суток и свободный текст
    weekdays      SMALLINT[] NOT NULL DEFAULT '{}' CHECK (weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]),
    day_parts     TEXT[] NOT NULL DEFAULT '{}' CHECK (day_parts <@ ARRAY['morning', 'day', 'evening']::text[]),
    schedule_note TEXT CHECK (schedule_note IS NULL OR char_length(schedule_note) BETWEEN 1 AND 500),
    comment       TEXT CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 1500),
    -- new: ждёт администратора; in_progress: взята в работу; closed: обработана администратором; canceled: отозвана автором
    status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'closed', 'canceled')),
    admin_note    TEXT CHECK (admin_note IS NULL OR char_length(admin_note) BETWEEN 1 AND 1000),
    handled_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    handled_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT match_budget_order CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max)
);

CREATE INDEX IF NOT EXISTS coach_match_requests_queue_idx ON coach_match_requests (status, created_at);
CREATE INDEX IF NOT EXISTS coach_match_requests_user_idx ON coach_match_requests (user_id, created_at DESC);
