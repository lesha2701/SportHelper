-- 0051: support requests: a signed-in person writes to the administrators (a question, a suggestion, a conflict, a problem) and
-- gets an answer. The queue is read by the administrators in «Поддержка»; the answer is also e-mailed and shown to the author.
CREATE TABLE IF NOT EXISTS support_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('question', 'suggestion', 'conflict', 'bug', 'payment', 'other')),
    subject      TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
    body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 3000),
    status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'answered', 'closed')),
    answer       TEXT CHECK (answer IS NULL OR char_length(answer) BETWEEN 3 AND 3000),
    handled_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    handled_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- an answered request always carries the answer; the others never do
    CONSTRAINT support_answer_matches_status CHECK ((status = 'answered') = (answer IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS support_requests_queue_idx ON support_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_requests_user_idx ON support_requests (user_id, created_at DESC);
