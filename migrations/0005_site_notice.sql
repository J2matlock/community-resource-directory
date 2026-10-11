-- One short notice the owner can show at the top of every public page
-- ("Code Blue shelter open tonight"). Plain text only. A single row (id 1).
CREATE TABLE site_notice (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  ends_on TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO site_notice (id) VALUES (1);
