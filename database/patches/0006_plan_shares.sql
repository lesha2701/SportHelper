-- Corrections pass (pre-iteration 6): training plans can be shown to teams,
-- symmetric to exercise_team_shares.

CREATE TABLE training_plan_team_shares (
    plan_id         UUID NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    shared_by       UUID NOT NULL REFERENCES users(id),
    shared_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, team_id)
);

CREATE INDEX training_plan_team_shares_team ON training_plan_team_shares(team_id);
