-- Lets an athlete attach a short note ("пожелания") when requesting a
-- booking, so the coach sees what they want before confirming. The plan a
-- coach picks for a confirmed booking's session lives on the linked
-- training's existing plan_id column — no schema change needed for that.
ALTER TABLE bookings ADD COLUMN athlete_notes TEXT;
