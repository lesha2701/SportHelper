-- Iteration 6: trainings (team, with a coach; or personal, for a player) and
-- attendance. "Independent team training" (with a responsible player and a
-- report) is iteration 7 — not part of this patch.

CREATE TABLE trainings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id                 UUID REFERENCES teams(id) ON DELETE CASCADE,
    created_by              UUID NOT NULL REFERENCES users(id),
    type                    TEXT NOT NULL CHECK (type IN ('team', 'personal')),
    plan_id                 UUID REFERENCES training_plans(id),
    training_date           DATE NOT NULL,
    start_time              TIME NOT NULL,
    duration_minutes        INTEGER NOT NULL CHECK (duration_minutes > 0),
    location                TEXT,
    description             TEXT,
    status                  TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    reminder_minutes_before SMALLINT,
    recurrence_group_id     UUID,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    CONSTRAINT trainings_team_required_for_team_type
        CHECK ((type = 'team' AND team_id IS NOT NULL) OR (type = 'personal' AND team_id IS NULL))
);

CREATE INDEX trainings_team ON trainings(team_id, training_date) WHERE deleted_at IS NULL;
CREATE INDEX trainings_owner ON trainings(created_by, training_date) WHERE deleted_at IS NULL;
CREATE INDEX trainings_recurrence_group ON trainings(recurrence_group_id) WHERE recurrence_group_id IS NOT NULL;

CREATE TRIGGER trainings_set_updated_at
    BEFORE UPDATE ON trainings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE training_attendance (
    training_id     UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent')),
    marked_by       UUID REFERENCES users(id),
    marked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (training_id, user_id)
);
