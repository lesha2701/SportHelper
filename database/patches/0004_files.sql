-- Iteration 4: Yandex.Disk-backed file storage metadata.
-- The OAuth token and file bytes never touch PostgreSQL — only metadata
-- needed to locate, authorize and clean up files does.

CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id),
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    disk_path       TEXT NOT NULL,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
    status          TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
    access_level    TEXT NOT NULL DEFAULT 'TEAM' CHECK (access_level IN ('PRIVATE', 'TEAM', 'COACHES_ONLY')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX files_team_entity ON files(team_id, entity_type);

CREATE TRIGGER files_set_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

ALTER TABLE teams
    ADD COLUMN logo_file_id UUID REFERENCES files(id);
