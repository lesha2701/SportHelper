-- 0044 (REF-19): training reminders already waiting in the queue are moved to the real moment.
-- Training times are wall-clock times of the platform's zone (SESSION_TIMEZONE, Europe/Moscow), but until now a reminder's
-- send_at was built reading them as UTC — three hours late in Moscow. The code now builds send_at from the platform's zone
-- (app/core/session_time.py); this recomputes the reminders that were queued the old way. Data only, no schema change.
-- The zone is written here as Europe/Moscow, the default of SESSION_TIMEZONE and the zone production runs in.

-- 1. every pending reminder: the training's time in the platform's zone, minus the training's "remind me before".
UPDATE notifications n
SET send_at = ((t.training_date + t.start_time) AT TIME ZONE 'Europe/Moscow') - make_interval(mins => t.reminder_minutes_before)
FROM trainings t
WHERE n.category = 'training_reminder'
  AND n.status = 'pending'
  AND n.entity_type = 'training'
  AND n.entity_id = t.id
  AND t.reminder_minutes_before IS NOT NULL;

-- 2. a "training soon" reminder for a training that has already begun is no longer news: it is withdrawn, not sent late.
UPDATE notifications n
SET status = 'cancelled'
FROM trainings t
WHERE n.category = 'training_reminder'
  AND n.status = 'pending'
  AND n.entity_type = 'training'
  AND n.entity_id = t.id
  AND ((t.training_date + t.start_time) AT TIME ZONE 'Europe/Moscow') <= now();
