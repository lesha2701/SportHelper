-- Iteration 8: tasks assigned by coach staff to players (team-wide, specific
-- players, by position, or absentees of a training), with a per-player
-- submission/review cycle similar in shape to iteration 7's training reports.

CREATE TABLE tasks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id               UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by            UUID NOT NULL REFERENCES users(id),
    title                 TEXT NOT NULL,
    description           TEXT,
    plan_id               UUID REFERENCES training_plans(id),
    deadline              TIMESTAMPTZ,
    metric_name           TEXT,
    metric_unit           TEXT,
    metric_target         NUMERIC,
    require_comment       BOOLEAN NOT NULL DEFAULT FALSE,
    require_photo         BOOLEAN NOT NULL DEFAULT FALSE,
    require_video         BOOLEAN NOT NULL DEFAULT FALSE,
    require_sets_reps     BOOLEAN NOT NULL DEFAULT FALSE,
    require_duration      BOOLEAN NOT NULL DEFAULT FALSE,
    require_metric_value  BOOLEAN NOT NULL DEFAULT FALSE,
    require_difficulty    BOOLEAN NOT NULL DEFAULT FALSE,
    require_wellbeing     BOOLEAN NOT NULL DEFAULT FALSE,
    -- How the assignee set was chosen at creation time (kept for display —
    -- the actual recipients are materialized as task_assignments rows below).
    target_type           TEXT NOT NULL CHECK (target_type IN ('team', 'players', 'position', 'absentees')),
    target_position       TEXT,
    target_training_id    UUID REFERENCES trainings(id),
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_team_id ON tasks(team_id);

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_exercises (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    exercise_id   UUID NOT NULL REFERENCES exercises(id),
    order_index   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX task_exercises_task_id ON task_exercises(task_id);

-- ============================================================================
-- Per-assignee status. 'overdue' and 'missed' are reserved for the
-- iteration-10 background job (deadline sweep) — nothing in this iteration
-- sets them yet.
-- ============================================================================

CREATE TABLE task_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    status              TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
                            'assigned', 'viewed', 'in_progress', 'submitted',
                            'accepted', 'needs_revision', 'overdue', 'missed', 'cancelled'
                        )),
    comment             TEXT,
    photo_file_id       UUID REFERENCES files(id),
    video_file_id       UUID REFERENCES files(id),
    sets                INTEGER,
    reps                INTEGER,
    duration_minutes    INTEGER,
    metric_value        NUMERIC,
    difficulty          INTEGER CHECK (difficulty BETWEEN 1 AND 10),
    wellbeing           INTEGER CHECK (wellbeing BETWEEN 1 AND 5),
    coach_comment       TEXT,
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    viewed_at           TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, user_id)
);

CREATE INDEX task_assignments_user_id ON task_assignments(user_id);

CREATE TRIGGER task_assignments_set_updated_at
    BEFORE UPDATE ON task_assignments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
