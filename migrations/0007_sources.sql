-- Public sources for each listing: up to 3 links that back up its details,
-- shown on the card as "Source". JSON array of {url, label, seen}.
ALTER TABLE listings ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
