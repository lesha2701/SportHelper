-- Iteration 3: teams, roles, invitations and join requests.

CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    sport           TEXT NOT NULL,
    age_category    TEXT,
    level           TEXT CHECK (level IN ('beginner', 'amateur', 'intermediate', 'advanced', 'professional')),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'without_coach')),
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER teams_set_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Membership: role per (team, user). Head coach and captain are capped at
-- one active holder per team via partial unique indexes; assistants and
-- players are unrestricted in count (up to the 50-member cap below).
-- ============================================================================

CREATE TABLE team_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('head_coach', 'assistant_coach', 'captain', 'player')),
    position    TEXT,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE UNIQUE INDEX team_members_one_head_coach ON team_members(team_id) WHERE role = 'head_coach';
CREATE UNIQUE INDEX team_members_one_captain ON team_members(team_id) WHERE role = 'captain';

CREATE OR REPLACE FUNCTION check_team_size() RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM team_members WHERE team_id = NEW.team_id) >= 50 THEN
        RAISE EXCEPTION 'team % already has the maximum of 50 members', NEW.team_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER team_members_max_size
    BEFORE INSERT ON team_members
    FOR EACH ROW
    EXECUTE FUNCTION check_team_size();

-- ============================================================================
-- Invitations: reusable links, 24h expiry. `kind = 'head_coach'` is the
-- captain-only special invite used when a team has status 'without_coach';
-- accepting it makes the acceptor head coach immediately, no application step.
-- ============================================================================

CREATE TABLE team_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL DEFAULT 'join' CHECK (kind IN ('join', 'head_coach')),
    created_by  UUID NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX team_invites_team_id ON team_invites(team_id);

-- ============================================================================
-- Join requests: one pending request per (team, user) at a time.
-- ============================================================================

CREATE TABLE team_join_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id     UUID NOT NULL REFERENCES team_invites(id),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    reviewed_by   UUID REFERENCES users(id),
    reviewed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_join_requests_one_pending ON team_join_requests(team_id, user_id) WHERE status = 'pending';

-- ============================================================================
-- Blocks: only the head coach can block a user from re-joining a team.
-- ============================================================================

CREATE TABLE team_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);
