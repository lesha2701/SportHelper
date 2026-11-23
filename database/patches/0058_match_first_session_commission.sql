-- 0058: «Подобрать тренера», этап 3 — повышенная комиссия за первую тренировку, окно атрибуции, привязка записи к подбору.
-- Только добавляет: одну таблицу, три колонки у предложений и одну у записей.

-- Журнал изменений общего процента первой тренировки (как commission_changes). Текущее значение — последняя строка;
-- пока строк нет, действует MATCH_FIRST_SESSION_COMMISSION_PERCENT из окружения. Платёж замораживает процент в момент оплаты,
-- а предложение — в момент создания, поэтому изменение не трогает уже созданное.
CREATE TABLE IF NOT EXISTS match_commission_changes (
    id           BIGSERIAL PRIMARY KEY,
    percent      NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    previous     NUMERIC(5, 2),
    reason       TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    changed_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_commission_changes_latest_idx ON match_commission_changes (id DESC);

-- Окно атрибуции: до какого момента записи спортсмена к этому тренеру идут по правилам подбора (ставится, когда спортсмен выбирает тренера).
ALTER TABLE coach_match_offers ADD COLUMN IF NOT EXISTS window_ends_at TIMESTAMPTZ;
-- Процент задан для этого предложения отдельно (а не взят из общего): причина обязательна и пишется в аудит.
ALTER TABLE coach_match_offers ADD COLUMN IF NOT EXISTS percent_overridden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coach_match_offers ADD COLUMN IF NOT EXISTS percent_reason TEXT
    CHECK (percent_reason IS NULL OR char_length(percent_reason) BETWEEN 1 AND 500);
UPDATE coach_match_offers SET window_ends_at = athlete_responded_at + interval '30 days'
 WHERE status = 'athlete_accepted' AND window_ends_at IS NULL AND athlete_responded_at IS NOT NULL;

-- Запись, которой достался повышенный процент и скрытие имени до оплаты. NULL — обычная запись.
-- SET NULL: удаление данных спортсмена (анкеты и предложения) не должно ломаться из-за записей.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS match_offer_id UUID REFERENCES coach_match_offers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_match_offer_idx ON bookings (match_offer_id) WHERE match_offer_id IS NOT NULL;
