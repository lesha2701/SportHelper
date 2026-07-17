-- Iteration 7: independent (self-run) team trainings with a responsible
-- player and a post-training report reviewed by the coach staff.

ALTER TABLE trainings DROP CONSTRAINT trainings_type_check;
ALTER TABLE trainings ADD CONSTRAINT trainings_type_check
    CHECK (type IN ('team', 'personal', 'independent'));

ALTER TABLE trainings DROP CONSTRAINT trainings_team_required_for_team_type;
ALTER TABLE trainings ADD CONSTRAINT trainings_team_required_for_team_type
    CHECK (
        (type IN ('team', 'independent') AND team_id IS NOT NULL)
        OR (type = 'personal' AND team_id IS NULL)
    );

ALTER TABLE trainings ADD COLUMN responsible_user_id UUID REFERENCES users(id);

CREATE TABLE training_reports (
    training_id     UUID PRIMARY KEY REFERENCES trainings(id) ON DELETE CASCADE,
    submitted_by    UUID NOT NULL REFERENCES users(id),
    text_report     TEXT NOT NULL,
    photo_file_id   UUID REFERENCES files(id),
    video_file_id   UUID REFERENCES files(id),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'needs_revision')),
    coach_comment   TEXT,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER training_reports_set_updated_at
    BEFORE UPDATE ON training_reports
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
