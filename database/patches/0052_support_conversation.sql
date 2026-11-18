-- 0052: a support request becomes a conversation: after the administrators' answer the author can reply, and so on until an
-- administrator closes it. The first message stays in support_requests.body; every later one (the author's reply or the
-- administrators' answer) is a row of support_messages. The single `answer` of 0051 moves into that list.
CREATE TABLE IF NOT EXISTS support_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  UUID NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
    author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    from_staff  BOOLEAN NOT NULL,
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 3 AND 3000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_request_idx ON support_messages (request_id, created_at, id);

-- When the person last wrote: the queue serves whoever has waited longest (a reply puts the request back in the queue).
ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;
UPDATE support_requests SET waiting_since = created_at WHERE waiting_since IS NULL;
ALTER TABLE support_requests ALTER COLUMN waiting_since SET NOT NULL;
ALTER TABLE support_requests ALTER COLUMN waiting_since SET DEFAULT now();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_requests' AND column_name = 'answer') THEN
        INSERT INTO support_messages (request_id, author_id, from_staff, body, created_at)
        SELECT id, handled_by, TRUE, answer, COALESCE(handled_at, updated_at) FROM support_requests WHERE answer IS NOT NULL;
    END IF;
END $$;

ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_answer_matches_status;
ALTER TABLE support_requests DROP COLUMN IF EXISTS answer;
