-- New coach signups require a human decision. Existing coaches have no row and stay approved.
CREATE TABLE coach_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    sport TEXT NOT NULL CHECK (length(sport) BETWEEN 2 AND 100),
    qualification TEXT NOT NULL CHECK (length(qualification) BETWEEN 2 AND 1000),
    experience TEXT NOT NULL CHECK (length(experience) BETWEEN 2 AND 2000),
    about TEXT NOT NULL DEFAULT '',
    links TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('pending', 'needs_info', 'approved', 'rejected')),
    admin_note TEXT,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    resubmit_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coach_applications_queue ON coach_applications (status, created_at);
CREATE TRIGGER coach_applications_set_updated_at BEFORE UPDATE ON coach_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coach_application_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES coach_applications(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX coach_application_documents_application ON coach_application_documents(application_id);

CREATE TABLE coach_application_events (
    id BIGSERIAL PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES coach_applications(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('submitted', 'resubmitted', 'needs_info', 'approved', 'rejected')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
