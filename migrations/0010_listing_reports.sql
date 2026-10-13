-- One-tap "This didn't work" reports on listings (owner decision, 2026-10-12).
-- Anonymous and tap-only: which listing and which of three reasons. No text,
-- nothing about the person. Reports never change a listing; they move it up
-- the owner's re-check list.
CREATE TABLE listing_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('phone', 'closed', 'full')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX listing_reports_listing ON listing_reports (listing_id, created_at);

-- Hourly limit for these reports, like request_rate (salted IP hash, kept one day).
CREATE TABLE report_rate (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX report_rate_lookup ON report_rate (ip_hash, created_at);
CREATE INDEX report_rate_age ON report_rate (created_at);
