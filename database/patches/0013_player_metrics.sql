-- Iteration 11: a universal player metric system (used for both "sport
-- metrics" tracking and personal records — records are computed on the fly
-- from these rows, not stored separately).

CREATE TABLE player_metrics (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recorded_by       UUID NOT NULL REFERENCES users(id),
    name              TEXT NOT NULL,
    unit              TEXT,
    value             NUMERIC NOT NULL,
    recorded_date     DATE NOT NULL,
    higher_is_better  BOOLEAN NOT NULL DEFAULT TRUE,
    source            TEXT,
    comment           TEXT,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX player_metrics_user_id ON player_metrics(user_id);

CREATE TRIGGER player_metrics_set_updated_at
    BEFORE UPDATE ON player_metrics
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
