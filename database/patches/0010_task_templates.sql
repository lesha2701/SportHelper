-- Corrections pass after iteration 8: reusable task templates. A coach
-- builds these once in the library (title/description/plan/exercises/report
-- requirements — everything about a task except who it goes to and when),
-- then quickly turns a template into a real per-team task via the normal
-- task-creation flow (target/deadline are picked at that point, not stored
-- on the template).

CREATE TABLE task_templates (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              UUID NOT NULL REFERENCES users(id),
    title                 TEXT NOT NULL,
    description           TEXT,
    plan_id               UUID REFERENCES training_plans(id),
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
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_templates_owner_id ON task_templates(owner_id);

CREATE TRIGGER task_templates_set_updated_at
    BEFORE UPDATE ON task_templates
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_template_exercises (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id   UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    exercise_id   UUID NOT NULL REFERENCES exercises(id),
    order_index   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX task_template_exercises_template_id ON task_template_exercises(template_id);
