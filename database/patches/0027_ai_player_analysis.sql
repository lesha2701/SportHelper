-- Player consent for AI analysis by a personal coach, plus the stored
-- analysis itself (one per personal training).
--
-- The consent is an explicit opt-in: DEFAULT FALSE also covers every
-- existing user, nobody is opted in by this patch.
ALTER TABLE users
    ADD COLUMN allow_ai_analysis_by_personal_coach BOOLEAN NOT NULL DEFAULT FALSE;

-- A coach's pre-session analysis of the athlete for one specific personal
-- training. It is a working note for that session, not a lasting profile of
-- the player: it is replaced when re-run, deleted with the training, and
-- deleted for ALL of a player's trainings the moment they withdraw consent.
CREATE TABLE training_ai_analyses (
    training_id     UUID PRIMARY KEY REFERENCES trainings(id) ON DELETE CASCADE,
    coach_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_json   TEXT NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX training_ai_analyses_player ON training_ai_analyses(player_user_id);
