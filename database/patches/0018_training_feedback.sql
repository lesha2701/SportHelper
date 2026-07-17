-- Post-iteration-15 touch-ups: lightweight self-reported feedback (how the
-- training felt) for ANY training the player attended (personal, team, or
-- independent) — separate from training_reports (which is the responsible
-- player's report on an independent training, reviewed by the coach).
-- This purely feeds the AI training-evaluation feature and is never seen
-- by anyone but the player and the AI. A row with skipped = TRUE marks
-- that the player was prompted and chose not to fill it in, so the
-- frontend prompt only ever shows once per training.

CREATE TABLE training_feedback (
    training_id   UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wellbeing     SMALLINT CHECK (wellbeing BETWEEN 1 AND 5),
    difficulty    SMALLINT CHECK (difficulty BETWEEN 1 AND 10),
    comment       TEXT,
    skipped       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (training_id, user_id)
);
