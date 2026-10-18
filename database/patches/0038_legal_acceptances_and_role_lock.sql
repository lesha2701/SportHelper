-- 0038: the record of what each user ticked at sign-up, and the role fixed at registration.
-- Additive: one new table (append-only) and a one-off fill of users.preferred_role from what the account already is.

-- 1. Acceptances. One row per ticked box, with the documents (title + edition) the box covered, who ticked it, when, from where.
CREATE TABLE IF NOT EXISTS legal_acceptances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id),
    role         TEXT NOT NULL CHECK (role IN ('player', 'coach')),
    full_name    TEXT NOT NULL,
    phone        TEXT,
    email        TEXT NOT NULL,
    consent_key  TEXT NOT NULL,
    documents    JSONB NOT NULL,
    accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address   TEXT
);
CREATE INDEX IF NOT EXISTS legal_acceptances_by_user ON legal_acceptances (user_id, accepted_at DESC);

-- Evidence: rows are never edited or removed.
CREATE OR REPLACE FUNCTION legal_acceptances_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'legal_acceptances is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS legal_acceptances_no_update ON legal_acceptances;
CREATE TRIGGER legal_acceptances_no_update
    BEFORE UPDATE OR DELETE ON legal_acceptances
    FOR EACH ROW EXECUTE FUNCTION legal_acceptances_append_only();

DROP TRIGGER IF EXISTS legal_acceptances_no_truncate ON legal_acceptances;
CREATE TRIGGER legal_acceptances_no_truncate
    BEFORE TRUNCATE ON legal_acceptances
    FOR EACH STATEMENT EXECUTE FUNCTION legal_acceptances_append_only();

-- 2. The role is chosen at registration and does not change. Existing accounts keep what they are today:
-- the mode they are working in, else the role they picked at sign-up, else the only profile they have.
-- Accounts with no signal stay NULL and fix their role when they create their first profile.
UPDATE users u
SET preferred_role = COALESCE(
        u.active_mode,
        u.preferred_role,
        CASE
            WHEN EXISTS (SELECT 1 FROM player_profiles p WHERE p.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id) THEN 'player'
            WHEN EXISTS (SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM player_profiles p WHERE p.user_id = u.id) THEN 'coach'
        END)
WHERE u.deleted_at IS NULL
  AND u.preferred_role IS DISTINCT FROM COALESCE(
        u.active_mode,
        u.preferred_role,
        CASE
            WHEN EXISTS (SELECT 1 FROM player_profiles p WHERE p.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id) THEN 'player'
            WHEN EXISTS (SELECT 1 FROM coach_profiles c WHERE c.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM player_profiles p WHERE p.user_id = u.id) THEN 'coach'
        END);
