-- Results of a personal training done in the guided "reps" mode: every set the person
-- actually did (repetitions, optional weight), how it felt and how long it took.
-- One row per training and person; the sets live in a JSON document because they are
-- only ever read and written together. Deleted with the training.

CREATE TABLE training_workouts (
    training_id  UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data         JSONB NOT NULL,
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (training_id, user_id)
);
