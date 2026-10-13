-- "To review" in the admin panel: decisions, checks and ideas waiting on the
-- owner. Admin-only; never read by public routes. `key` is a stable id from
-- the source, so re-running the seed script never duplicates an item or
-- resets the owner's answer.
CREATE TABLE review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'call', 'decision', 'fyi', 'idea', 'task', 'info')),
  grp TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  listing_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  owner_note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX review_items_status ON review_items (status, grp, sort);
