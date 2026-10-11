-- Two honest "checked" dates per listing:
--   last_verified        = confirmed with the program (owner's call or email)
--   last_checked_online  = checked against the program's own website or an
--                          official source (research passes)
-- Backfilled from the change history: the latest research import or update.
ALTER TABLE listings ADD COLUMN last_checked_online TEXT NOT NULL DEFAULT '';
UPDATE listings SET last_checked_online = COALESCE(
  (SELECT substr(MAX(h.changed_at), 1, 10) FROM listing_history h
    WHERE h.listing_id = listings.id AND h.changed_by LIKE 'research%'), '');
