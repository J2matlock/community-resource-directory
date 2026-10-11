-- Hourly limit for the provider request form. Holds a salted hash of the
-- sender's IP address (never the address itself), kept for one day.
CREATE TABLE request_rate (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX request_rate_lookup ON request_rate (ip_hash, created_at);
CREATE INDEX request_rate_age ON request_rate (created_at);
