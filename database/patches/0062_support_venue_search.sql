ALTER TABLE support_requests
    DROP CONSTRAINT support_requests_kind_check,
    ADD CONSTRAINT support_requests_kind_check
        CHECK (kind IN ('question', 'suggestion', 'conflict', 'bug', 'payment', 'other', 'venue_search'));
