-- Iteration 2: player/coach profiles + active mode switch.

ALTER TABLE users
    ADD COLUMN active_mode TEXT CHECK (active_mode IN ('player', 'coach'));

CREATE TABLE player_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    age                 SMALLINT CHECK (age BETWEEN 3 AND 100),
    height_cm           SMALLINT CHECK (height_cm BETWEEN 50 AND 260),
    weight_kg           NUMERIC(5, 1) CHECK (weight_kg BETWEEN 15 AND 300),
    sport               TEXT NOT NULL,
    position            TEXT,
    level               TEXT CHECK (level IN ('beginner', 'amateur', 'intermediate', 'advanced', 'professional')),
    goals               TEXT,
    load_restrictions   TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER player_profiles_set_updated_at
    BEFORE UPDATE ON player_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE coach_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    sport               TEXT NOT NULL,
    experience_years    SMALLINT CHECK (experience_years BETWEEN 0 AND 80),
    specialization      TEXT,
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER coach_profiles_set_updated_at
    BEFORE UPDATE ON coach_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
