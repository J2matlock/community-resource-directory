// Which listing fields the owner set last, from the change history. Research
// updates (scripts/update-live.mjs, /refresh-info) never change these fields:
// the owner's own knowledge (often from a phone call) beats a website. If a
// source disagrees, it becomes a call-list question instead.
//
// A history row is the owner's when changed_by is an email (an admin-panel
// save; only the owner can save there) or starts with "owner" (a change the
// owner asked Claude to make, see OWNER_VIA_CLAUDE). Renaming a category or
// plan in the admin panel touches every listing that uses it, so those rows
// don't count: they're labeled "(list rename)" and, for renames made before
// that label existed, they're the admin-panel rows that share one save time
// across more than one listing (an admin save touches one listing; a batch
// the owner asked Claude to apply is still the owner's).

export const OWNER_VIA_CLAUDE = 'owner via Claude';
export const LIST_RENAME = '(list rename)';

// True when an update's _src says the owner gave the answer, using one of the
// labels Claude writes ("owner answer…", "owner approved…", "owner asked…",
// "owner (To review…)", "owner-provided…"), not a source that merely starts
// with the word ("Owner's Facebook page says…").
export const isOwnerSrc = (src) => /^owner(\s*\(|[\s-](answer|approved|asked|request|provided|decision|confirmed)\b)/i.test(String(src ?? '').trim());

export const isOwnerRow = (row) => {
  const by = String(row.changed_by ?? '');
  return (by.includes('@') || /^owner/i.test(by)) && !by.includes(LIST_RENAME);
};

// rows: listing_history rows ({ listing_id, field, new_value, changed_by, changed_at }), any order.
// Returns Map<listing_id, Map<field, { value, at }>> for fields whose latest change was the owner's.
export function ownerSetFields(rows) {
  const ordered = [...rows].sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)) || (a.id ?? 0) - (b.id ?? 0));
  const listingsAt = new Map();
  for (const r of ordered) if (isOwnerRow(r) && String(r.changed_by).includes('@')) {
    const key = `${r.changed_by}|${r.changed_at}`;
    if (!listingsAt.has(key)) listingsAt.set(key, new Set());
    listingsAt.get(key).add(r.listing_id);
  }
  const latest = new Map();
  for (const r of ordered) {
    if (r.field === 'created') continue;
    const bulk = (listingsAt.get(`${r.changed_by}|${r.changed_at}`)?.size ?? 0) > 1;
    if (!latest.has(r.listing_id)) latest.set(r.listing_id, new Map());
    latest.get(r.listing_id).set(r.field, isOwnerRow(r) && !bulk ? { value: r.new_value, at: r.changed_at } : null);
  }
  const out = new Map();
  for (const [id, fields] of latest) {
    const owned = new Map([...fields].filter(([, v]) => v));
    if (owned.size) out.set(id, owned);
  }
  return out;
}
