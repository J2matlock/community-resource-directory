-- Anonymous "barriers to getting help" reports from the Community needs page.
-- No names, contact details, towns or addresses: just a county, the barriers
-- ticked, an optional short comment (shown only to the owner) and whether the
-- person is reporting for themselves or as a helper.
CREATE TABLE barrier_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  county TEXT NOT NULL,
  barriers TEXT NOT NULL DEFAULT '[]',
  reporter TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX barrier_reports_created ON barrier_reports (created_at);

-- Hourly limit for that form, like request_rate (salted IP hash, kept one day).
CREATE TABLE barrier_rate (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX barrier_rate_lookup ON barrier_rate (ip_hash, created_at);
CREATE INDEX barrier_rate_age ON barrier_rate (created_at);
