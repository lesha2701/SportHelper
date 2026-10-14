-- 1. External sign-in providers (Yandex ID, VK ID, ...) as a many-to-one link to
--    users.id. Only the data model: no provider is wired up yet. Rules that the
--    schema itself enforces:
--      * one external account belongs to exactly one user  (provider, provider_user_id) UNIQUE
--      * a user has at most one account per provider        (user_id, provider) UNIQUE
--    Linking never happens by matching email alone - see app/services/identities.py.
--    `provider` is a free slug so a new provider needs no migration; the set of
--    ENABLED providers is an application allowlist.
CREATE TABLE IF NOT EXISTS user_identities (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider                TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
    provider_user_id        TEXT NOT NULL CHECK (length(provider_user_id) BETWEEN 1 AND 255),
    provider_email          TEXT,
    provider_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_name            TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at           TIMESTAMPTZ,
    CONSTRAINT user_identities_external_unique UNIQUE (provider, provider_user_id),
    CONSTRAINT user_identities_one_per_provider UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);

-- 2. Shared rate-limit state for the sensitive auth endpoints, so the limits
--    hold across several backend processes (an in-process counter does not).
--    UNLOGGED: much cheaper, and losing it in a crash only resets the counters.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_hits (
    key     TEXT NOT NULL,
    hit_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_key ON rate_limit_hits (key, hit_at);

-- 3. The admin audit trail also records administrators of the website, who are
--    identified by account rather than by Telegram id.
ALTER TABLE admin_audit_log ALTER COLUMN admin_telegram_id DROP NOT NULL;
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS admin_user_id UUID REFERENCES users(id);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_log_actor') THEN
        ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_actor
            CHECK (admin_telegram_id IS NOT NULL OR admin_user_id IS NOT NULL);
    END IF;
END $$;
