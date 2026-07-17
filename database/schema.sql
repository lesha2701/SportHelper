-- TeamFlow Sports — baseline schema for a fresh database.
-- Applied automatically on startup when the "schema_versions" table is missing.
-- For an already existing database, sequential files in database/patches/ are
-- applied instead (see app/database.py).

-- ============================================================================
-- Infrastructure
-- ============================================================================

CREATE TABLE schema_versions (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reusable trigger to keep an "updated_at" column current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Users (iteration 1: identity from Telegram auth only; profile fields for
-- player/coach modes are added in iteration 2)
-- ============================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id     BIGINT NOT NULL UNIQUE,
    username        TEXT,
    first_name      TEXT NOT NULL,
    last_name       TEXT,
    photo_url       TEXT,
    language_code   TEXT,
    is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
    banned_at       TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Baseline version marker
-- ============================================================================

INSERT INTO schema_versions (version, name) VALUES (1, 'schema.sql baseline');
