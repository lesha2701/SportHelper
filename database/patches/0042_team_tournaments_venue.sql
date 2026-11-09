-- A team's tournaments (the match form offers them) and its home venue (home matches take it as their place).
ALTER TABLE teams ADD COLUMN tournaments TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE teams ADD COLUMN home_venue TEXT;
