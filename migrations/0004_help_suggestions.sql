-- Anonymous "Don't see the help you need?" messages from the directory.
-- No names or contact details: just what kind of help the person was looking
-- for and, optionally, a county. Only the owner sees these.
CREATE TABLE help_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  looking_for TEXT NOT NULL,
  county TEXT NOT NULL DEFAULT '',
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Hourly limit for that form, like barrier_rate (salted IP hash, kept one day).
CREATE TABLE suggestion_rate (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX suggestion_rate_lookup ON suggestion_rate (ip_hash, created_at);
CREATE INDEX suggestion_rate_age ON suggestion_rate (created_at);
