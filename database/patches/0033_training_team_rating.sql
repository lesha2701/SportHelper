-- The coach's overall rating of how the TEAM did on a training (1-5), kept apart from
-- the player's own "wellbeing" so it never leaks into a player's AI analysis.
-- Additive and nullable: the previous application version ignores the column.
ALTER TABLE training_feedback ADD COLUMN IF NOT EXISTS team_rating SMALLINT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_feedback_team_rating_range') THEN
        ALTER TABLE training_feedback ADD CONSTRAINT training_feedback_team_rating_range
            CHECK (team_rating IS NULL OR team_rating BETWEEN 1 AND 5);
    END IF;
END $$;
