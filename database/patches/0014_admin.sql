-- Iteration 13: admin bot commands — audit trail for admin actions and a
-- centralized, sanitized error log fed by both the backend and bot
-- processes (see app/core/error_log.py). No secrets are ever written here —
-- logging.py's rule against logging tokens/passwords/initData applies to
-- every record that ends up in this table too.

CREATE TABLE admin_audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_telegram_id   BIGINT NOT NULL,
    action              TEXT NOT NULL,
    target_type         TEXT,
    target_id           TEXT,
    details             JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_at ON admin_audit_log(created_at DESC);

CREATE TABLE error_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source        TEXT NOT NULL CHECK (source IN ('backend', 'bot')),
    logger_name   TEXT NOT NULL,
    message       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX error_log_created_at ON error_log(created_at DESC);
