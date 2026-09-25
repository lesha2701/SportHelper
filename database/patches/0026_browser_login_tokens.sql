-- One-time tokens for logging in from a regular browser (outside the
-- Telegram Mini App). The browser creates a token, the user confirms it in
-- the bot (which sets user_id), then the browser exchanges it for a JWT.
CREATE TABLE browser_login_tokens (
    token       TEXT PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX browser_login_tokens_expires ON browser_login_tokens(expires_at);
