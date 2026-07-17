-- Iteration 9: matches. Result (win/loss/draw) is derived from the score at
-- read time rather than stored, so it can never drift out of sync with it.

CREATE TABLE matches (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id           UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by        UUID NOT NULL REFERENCES users(id),
    opponent_name     TEXT NOT NULL,
    match_date        DATE NOT NULL,
    start_time        TIME NOT NULL,
    location          TEXT,
    is_home           BOOLEAN NOT NULL DEFAULT TRUE,
    tournament        TEXT,
    status            TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    our_score         INTEGER CHECK (our_score >= 0),
    opponent_score    INTEGER CHECK (opponent_score >= 0),
    comment           TEXT,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX matches_team_id ON matches(team_id);

CREATE TRIGGER matches_set_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Lineup for the match. No per-player stats and no player confirmation at
-- this stage — just who the coach picked.
CREATE TABLE match_roster (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    UNIQUE (match_id, user_id)
);

CREATE INDEX match_roster_match_id ON match_roster(match_id);
