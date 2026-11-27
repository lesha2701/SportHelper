-- Unique daily opens for listings, including anonymous visitors, and players' saved listings.
ALTER TABLE coach_listings ADD COLUMN views_count INTEGER NOT NULL DEFAULT 0 CHECK (views_count >= 0);

CREATE TABLE coach_listing_views (
    listing_id UUID NOT NULL REFERENCES coach_listings(id) ON DELETE CASCADE,
    viewer_key TEXT NOT NULL CHECK (length(viewer_key) = 64),
    viewed_on DATE NOT NULL,
    PRIMARY KEY (listing_id, viewer_key, viewed_on)
);
CREATE INDEX coach_listing_views_day_idx ON coach_listing_views(viewed_on);

CREATE TABLE coach_listing_favorites (
    listing_id UUID NOT NULL REFERENCES coach_listings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (listing_id, user_id)
);
CREATE INDEX coach_listing_favorites_user_idx ON coach_listing_favorites(user_id, created_at DESC);
