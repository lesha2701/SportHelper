-- Which version of the welcome guide the user has finished (or skipped).
-- 0 = never. Bumping CURRENT_ONBOARDING_VERSION in the backend shows the
-- guide again to everyone below it. Stored on the account, not the device,
-- so finishing it in Telegram means it isn't shown again in the browser.
ALTER TABLE users
    ADD COLUMN completed_onboarding_version SMALLINT NOT NULL DEFAULT 0;
