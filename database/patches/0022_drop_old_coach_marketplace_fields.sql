-- database/patches/0022_drop_old_coach_marketplace_fields.sql
-- Retires the pre-coach_listings marketplace model now that
-- backend/app/api/routes/coaches.py and backend/app/repositories/
-- coach_marketplace.py are deleted and nothing reads these anymore.

ALTER TABLE coach_profiles
    DROP COLUMN is_listed,
    DROP COLUMN price_per_session,
    DROP COLUMN currency,
    DROP COLUMN offers_online,
    DROP COLUMN offers_offline,
    DROP COLUMN location,
    DROP COLUMN session_duration_minutes;

DROP TABLE coach_availability_templates;
