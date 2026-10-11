-- Initial schema for the resource directory.
--
-- Multi-value fields (tags, counties, age groups, cost, Medicaid plans) are
-- stored as JSON lists inside each listing, e.g. ["Warren","Washington"].
-- The site loads all public listings at once and filters them in the
-- browser, and SQLite's json_each() can filter them on the server when needed.

CREATE TABLE categories (
  name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE medicaid_plans (
  name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE listings (
  id TEXT PRIMARY KEY CHECK (id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*' AND length(id) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  organization TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL REFERENCES categories(name),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  phone TEXT NOT NULL DEFAULT '',
  fax TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  town TEXT NOT NULL DEFAULT '',
  serves_counties TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(serves_counties) AND json_type(serves_counties) = 'array'),
  hours TEXT NOT NULL DEFAULT '',
  eligibility TEXT NOT NULL DEFAULT '',
  age_groups TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(age_groups) AND json_type(age_groups) = 'array'),
  cost TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cost) AND json_type(cost) = 'array'),
  medicaid_plans TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(medicaid_plans) AND json_type(medicaid_plans) = 'array'),
  medicaid_notes TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Admin-only. Never selected by public queries.
  private_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Temporarily closed', 'Seasonal')),
  review_by TEXT NOT NULL DEFAULT '' CHECK (review_by = '' OR review_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Admin-only. 'Internal' hides the whole listing from the public.
  visibility TEXT NOT NULL DEFAULT 'Public' CHECK (visibility IN ('Public', 'Internal')),
  last_verified TEXT NOT NULL DEFAULT '' CHECK (last_verified = '' OR last_verified GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Admin-only. Retired listings are hidden publicly but kept and restorable.
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX listings_public ON listings (visibility, retired, name);
CREATE INDEX listings_category ON listings (category);

-- One row per changed field on every save.
CREATE TABLE listing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  field TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX listing_history_listing ON listing_history (listing_id, id);

-- Provider requests from the public form (Phase 5). Untrusted text: always
-- escaped when shown, never rendered as HTML.
CREATE TABLE provider_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Handled')),
  handled_note TEXT NOT NULL DEFAULT '',
  handled_at TEXT NOT NULL DEFAULT '',
  listing_id TEXT NOT NULL DEFAULT '',
  email_sent INTEGER NOT NULL DEFAULT 0 CHECK (email_sent IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX provider_requests_status ON provider_requests (status, id);
