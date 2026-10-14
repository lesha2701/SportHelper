-- Web authentication (email + password, server-side sessions).
--
-- Telegram stops being the identity. users.id stays the primary key that every
-- other table references, so existing trainings, bookings, teams, profiles and
-- notifications are untouched. Existing users keep their row (and telegram_id);
-- they get an email and a password later through the bot-verified "claim"
-- flow (see app/api/routes/auth.py), never automatically.
--
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- users: credentials, consent, lifecycle
-- ---------------------------------------------------------------------------

ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email                TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_role       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_lowercase') THEN
        ALTER TABLE users ADD CONSTRAINT users_email_lowercase
            CHECK (email IS NULL OR email = lower(email));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_role_valid') THEN
        ALTER TABLE users ADD CONSTRAINT users_preferred_role_valid
            CHECK (preferred_role IS NULL OR preferred_role IN ('player', 'coach'));
    END IF;
END $$;

-- Uniqueness is enforced by the database, case-insensitively, not just by the
-- application. Rows without an email (legacy Telegram accounts that haven't
-- migrated yet) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Server-side sessions. The browser holds a random opaque id; only its SHA-256
-- is stored here, so a database leak doesn't yield usable session ids.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        TEXT NOT NULL UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    mfa_verified_at   TIMESTAMPTZ,
    user_agent        TEXT,
    ip_address        TEXT
);

CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_expires ON user_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- One-time tokens: email verification, password reset, email change, and the
-- two Telegram flows (claiming a legacy account, linking Telegram for
-- notifications). Again only hashes are stored; a token is spent by setting
-- used_at atomically.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN (
                    'email_verify', 'password_reset', 'email_change', 'telegram_claim', 'telegram_link')),
    token_hash  TEXT NOT NULL UNIQUE,
    new_email   TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_tokens_expires ON auth_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- TOTP second factor (required for admins before financial operations).
-- The secret is stored encrypted; recovery codes only as hashes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_mfa (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,
    enabled_at       TIMESTAMPTZ,
    recovery_hashes  TEXT[] NOT NULL DEFAULT '{}',
    last_used_step   BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The old "log in through the bot" handshake is replaced by the flows above.
-- It only ever held short-lived (5 minute) handshake tokens, no user data.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS browser_login_tokens;
