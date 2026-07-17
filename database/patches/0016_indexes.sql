-- Iteration 15: fill two missing indexes found during the optimization pass.
--
-- Both tables already have a composite PRIMARY KEY/UNIQUE constraint with a
-- *different* leading column (team_id / training_id respectively), which
-- Postgres cannot use for a user_id-only lookup. Both columns are queried
-- by themselves very frequently:
--   * team_members.user_id  — list_my_teams, shares_team_as_coach (every
--     player-stats/metrics access by a coach), and every "which teams does
--     this user belong to" subquery (match history, calendar, trainings).
--   * training_attendance.user_id — player_attendance_summary and
--     player_attendance_history, which back both the stats screens and the
--     iteration 14 AI progress-analysis feature.

CREATE INDEX team_members_user_id ON team_members(user_id);
CREATE INDEX training_attendance_user_id ON training_attendance(user_id);
