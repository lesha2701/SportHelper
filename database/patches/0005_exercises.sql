-- Iteration 5: exercises (coach's personal library) + reusable training plans.

CREATE TABLE exercises (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES users(id),
    sport               TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    goal                TEXT,
    photo_file_id       UUID REFERENCES files(id),
    video_file_id       UUID REFERENCES files(id),
    sets                SMALLINT CHECK (sets >= 0),
    reps                SMALLINT CHECK (reps >= 0),
    duration_seconds    INTEGER CHECK (duration_seconds >= 0),
    rest_seconds        INTEGER CHECK (rest_seconds >= 0),
    equipment           TEXT,
    difficulty          TEXT CHECK (difficulty IN ('beginner', 'amateur', 'intermediate', 'advanced', 'professional')),
    technique           TEXT,
    common_mistakes     TEXT,
    warnings            TEXT,
    coach_comment       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX exercises_owner ON exercises(owner_id) WHERE deleted_at IS NULL;

CREATE TRIGGER exercises_set_updated_at
    BEFORE UPDATE ON exercises
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE exercise_team_shares (
    exercise_id     UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    shared_by       UUID NOT NULL REFERENCES users(id),
    shared_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (exercise_id, team_id)
);

CREATE INDEX exercise_team_shares_team ON exercise_team_shares(team_id);

CREATE TABLE training_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES users(id),
    sport               TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    duration_minutes    INTEGER CHECK (duration_minutes >= 0),
    equipment           TEXT,
    comment             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX training_plans_owner ON training_plans(owner_id) WHERE deleted_at IS NULL;

CREATE TRIGGER training_plans_set_updated_at
    BEFORE UPDATE ON training_plans
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE training_plan_exercises (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             UUID NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    exercise_id         UUID NOT NULL REFERENCES exercises(id),
    section             TEXT NOT NULL CHECK (section IN ('warmup', 'main', 'game', 'cooldown')),
    order_index         SMALLINT NOT NULL DEFAULT 0,
    sets                SMALLINT CHECK (sets >= 0),
    reps                SMALLINT CHECK (reps >= 0),
    duration_seconds    INTEGER CHECK (duration_seconds >= 0),
    rest_seconds        INTEGER CHECK (rest_seconds >= 0),
    notes               TEXT
);

CREATE INDEX training_plan_exercises_plan ON training_plan_exercises(plan_id, section, order_index);
