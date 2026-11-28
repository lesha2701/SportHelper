-- Allow a coach to submit a legible qualification document up to 10 MiB.
ALTER TABLE coach_application_documents
    DROP CONSTRAINT IF EXISTS coach_application_documents_content_check;
ALTER TABLE coach_application_documents
    ADD CONSTRAINT coach_application_documents_content_check
    CHECK (octet_length(content) BETWEEN 1 AND 10485760);
