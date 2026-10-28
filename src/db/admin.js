// Admin queries. Only called from routes that have passed the admin check.
// Every change to a listing writes one history row per changed field.

import { validateListing, makeListingId, validateListName, isDvListing } from '../validate.js';
import { sourcesText } from '../lib/listing-rules.js';
import { parseList } from './public.js';

const JSON_COLUMNS = ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans', 'sources'];
export const EDITABLE_FIELDS = [
  'name', 'organization', 'category', 'tags', 'phone', 'fax', 'email', 'website', 'address', 'town',
  'serves_counties', 'hours', 'eligibility', 'age_groups', 'cost', 'medicaid_plans', 'medicaid_notes',
  'description', 'private_notes', 'status', 'review_by', 'visibility', 'last_verified', 'last_checked_online',
  'sources',
];

export class UserError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : 'Request failed');
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}

function now() {
  return new Date().toISOString();
}

// Today's date where the owner works (upstate NY), as YYYY-MM-DD.
export function todayLocal(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Every listing the admin panel gets carries its re-check date, worked out
// here only (the panel shows it; it has no copy of the rule).
function parseRow(row) {
  if (!row) return null;
  const out = { ...row, retired: Boolean(row.retired) };
  for (const c of JSON_COLUMNS) out[c] = parseList(row[c], `${row.id}.${c}`);
  out.recheck_due = recheckDueDate(out);
  return out;
}

function toDb(field, value) {
  return JSON_COLUMNS.includes(field) ? JSON.stringify(value ?? []) : value ?? '';
}

function historyValue(field, value) {
  if (field === 'sources') return sourcesText(value);
  if (JSON_COLUMNS.includes(field)) return (value ?? []).join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value ?? '');
}

async function managedLists(db) {
  const [c, p] = await db.batch([
    db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE'),
    db.prepare('SELECT name FROM medicaid_plans ORDER BY name COLLATE NOCASE'),
  ]);
  return { categories: c.results.map((r) => r.name), plans: p.results.map((r) => r.name) };
}

export async function listAllListings(db) {
  const { results } = await db.prepare('SELECT * FROM listings ORDER BY name COLLATE NOCASE').all();
  return results.map(parseRow);
}

export async function getListing(db, id) {
  return parseRow(await db.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first());
}

export async function getHistory(db, id) {
  const { results } = await db
    .prepare('SELECT field, old_value, new_value, changed_by, changed_at FROM listing_history WHERE listing_id = ? ORDER BY id DESC LIMIT 500')
    .bind(id).all();
  return results;
}

function checkInput(input, lists, opts = {}) {
  const { value, errors, warnings: found } = validateListing(input, lists, opts);
  const warnings = [...found, ...(Object.keys(errors).length ? [] : opts.extraWarnings ?? [])];
  if (Object.keys(errors).length) throw new UserError(422, { error: 'Please fix the highlighted fields.', errors, warnings });
  if (warnings.length && input.confirm_warnings !== true) {
    throw new UserError(422, { error: 'Please check these warnings, then choose "Save anyway" if they are fine.', errors: {}, warnings });
  }
  return value;
}

export async function createListing(db, input, who) {
  const lists = await managedLists(db);
  const { results } = await db.prepare('SELECT id, name, retired FROM listings').all();
  // A listing with the same name is usually a double tap or a duplicate:
  // ask before adding a second one ("Save anyway" adds it).
  const same = results.find((r) => r.name.trim().toLowerCase() === String(input?.name ?? '').trim().toLowerCase());
  const v = checkInput(input, lists, {
    extraWarnings: same ? [`A listing named "${same.name}" already exists${same.retired ? ' (retired; you can restore it from "Retired")' : ''}. Add another one only if this is a different program.`] : [],
  });
  const id = makeListingId(v.name, new Set(results.map((r) => r.id)));
  const t = now();
  const cols = ['id', ...EDITABLE_FIELDS, 'retired', 'created_at', 'updated_at'];
  const vals = [id, ...EDITABLE_FIELDS.map((f) => toDb(f, v[f])), 0, t, t];
  const insertListing = `INSERT INTO listings (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')}`;
  const insertHistory = 'INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) SELECT ?, ?, ?, ?, ?, ?';
  const fromRequest = input.from_request_id;
  if (fromRequest === undefined) {
    try {
      await db.batch([db.prepare(insertListing).bind(...vals), db.prepare(insertHistory).bind(id, 'created', '', v.name, who, t)]);
    } catch (err) {
      // Two saves of the same new listing at the same moment (a double tap):
      // the second finds the address taken. Nothing was added twice.
      if (/UNIQUE/i.test(String(err?.message))) throw new UserError(409, 'This listing was just added (a second tap?). Check the listings list before adding it again.');
      throw err;
    }
    return getListing(db, id);
  }
  // "Create listing from this": mark the request handled and create the
  // listing in one step. The listing is only added if this save is the one
  // that changed the request from New to Handled, so it can't happen twice.
  if (!Number.isInteger(fromRequest) || fromRequest < 1) throw new UserError(422, 'Unknown provider request.');
  const [claim] = await db.batch([
    db.prepare("UPDATE provider_requests SET status = 'Handled', handled_note = ?, handled_at = ?, listing_id = ? WHERE id = ? AND status = 'New'")
      .bind(`Listing created: ${v.name}`.slice(0, 500), t, id, fromRequest),
    db.prepare(`${insertListing} WHERE changes() = 1`).bind(...vals),
    db.prepare(`${insertHistory} WHERE changes() = 1`).bind(id, 'created', '', v.name, who, t),
  ]);
  if (claim.meta.changes !== 1) throw new UserError(409, 'That provider request was already handled. Check the listings list before adding it again.');
  return getListing(db, id);
}

// Applies `changes` (field → new value) and records history. `expectedUpdatedAt`
// stops two browser tabs from silently overwriting each other.
async function applyChanges(db, existing, changes, who, expectedUpdatedAt) {
  const fields = Object.keys(changes).filter(
    (f) => historyValue(f, changes[f]) !== historyValue(f, existing[f]) || (f === 'retired' && changes[f] !== existing[f]),
  );
  if (!fields.length) return existing;
  const t = now();
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  const update = db
    .prepare(`UPDATE listings SET ${sets}, updated_at = ? WHERE id = ? AND updated_at = ?`)
    .bind(...fields.map((f) => (f === 'retired' ? (changes[f] ? 1 : 0) : toDb(f, changes[f]))), t, existing.id, expectedUpdatedAt ?? existing.updated_at);
  const history = fields.map((f) =>
    db.prepare('INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(existing.id, f, historyValue(f, existing[f]), historyValue(f, changes[f]), who, t),
  );
  // Each history insert runs only if the statement before it changed a row,
  // so if the UPDATE matched nothing (stale edit), no history is written.
  const [res] = await db.batch([update, ...history]);
  if (res.meta.changes !== 1) {
    throw new UserError(409, 'This listing was changed somewhere else (another tab?). Reload it and try again.');
  }
  return getListing(db, existing.id);
}

export async function updateListing(db, id, input, who) {
  const existing = await getListing(db, id);
  if (!existing) throw new UserError(404, 'Listing not found.');
  const lists = await managedLists(db);
  // A DV program's saved address was confirmed as an office when it was saved,
  // so it stays confirmed until it changes. Other listings must confirm afresh
  // if they become DV programs.
  const v = checkInput(input, lists, { confirmedAddress: isDvListing(existing) && existing.address ? existing.address : undefined });
  const changes = {};
  for (const f of EDITABLE_FIELDS) changes[f] = v[f];
  return applyChanges(db, existing, changes, who, input.expected_updated_at);
}

export async function markVerified(db, id, who) {
  const existing = await getListing(db, id);
  if (!existing) throw new UserError(404, 'Listing not found.');
  return applyChanges(db, existing, { last_verified: todayLocal() }, who);
}

export async function setRetired(db, id, retired, who) {
  const existing = await getListing(db, id);
  if (!existing) throw new UserError(404, 'Listing not found.');
  return applyChanges(db, existing, { retired }, who);
}

// "Due for re-check", in tiers sized for one volunteer. Life-safety and
// basic-needs categories are checked every 3 months; everything else yearly.
// A listing counts as checked by the later of its two dates (confirmed with
// the program, or checked online). Past a "Re-check by" date always counts.
export const RECHECK_MONTHS_FAST = 3;
export const RECHECK_MONTHS = 12;
export const FAST_RECHECK_CATEGORIES = ['Crisis Help', 'Domestic Violence', 'Housing and Shelter', 'Food', 'Rent, Utility and Emergency Help'];

export function recheckDueDate(l) {
  const checked = [l.last_verified, l.last_checked_online].filter(Boolean).sort().pop();
  if (!checked) return '';
  const d = new Date(`${checked}T12:00:00Z`);
  const months = FAST_RECHECK_CATEGORIES.includes(l.category) ? RECHECK_MONTHS_FAST : RECHECK_MONTHS;
  // Same day of the month, or the last day if that month is shorter
  // (Jan 31 + 3 months is Apr 30, not May 1).
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return first.toISOString().slice(0, 10);
}

export async function dueForRecheck(db, today = todayLocal()) {
  const { results } = await db.prepare('SELECT * FROM listings WHERE retired = 0 ORDER BY name COLLATE NOCASE').all();
  const all = results.map(parseRow);
  const pastReview = (l) => l.review_by && l.review_by <= today;
  const due = all.filter((l) => pastReview(l) || !l.recheck_due || l.recheck_due <= today);
  due.sort((a, b) => (pastReview(b) - pastReview(a)) || (a.recheck_due || '').localeCompare(b.recheck_due || '') || a.name.localeCompare(b.name));
  return due;
}

// Listings never confirmed with the program (by phone or email), oldest check first.
export async function notYetConfirmed(db) {
  const { results } = await db.prepare(`SELECT * FROM listings WHERE retired = 0 AND last_verified = ''
    ORDER BY last_checked_online, name COLLATE NOCASE`).all();
  return results.map(parseRow);
}

// ---- Managed lists (categories and Medicaid plans) ----

const LIST_TABLES = {
  categories: { table: 'categories', column: 'category', json: false },
  plans: { table: 'medicaid_plans', column: 'medicaid_plans', json: true },
};

// `locked` names (src/lib/site-names.js) come back with locked: true, so the
// admin panel can say why they can't be renamed.
export async function getManagedList(db, kind, locked = new Set()) {
  const L = LIST_TABLES[kind];
  const usage = L.json
    ? `(SELECT COUNT(*) FROM listings, json_each(listings.medicaid_plans) j WHERE j.value = t.name)`
    : `(SELECT COUNT(*) FROM listings WHERE listings.category = t.name)`;
  const { results } = await db.prepare(`SELECT t.name, ${usage} AS used FROM ${L.table} t ORDER BY t.name COLLATE NOCASE`).all();
  return results.map((r) => ({ ...r, locked: locked.has(r.name) }));
}

export async function addListItem(db, kind, rawName, locked) {
  const L = LIST_TABLES[kind];
  const { value, error } = validateListName(rawName);
  if (error) throw new UserError(422, error);
  const exists = await db.prepare(`SELECT 1 FROM ${L.table} WHERE name = ? COLLATE NOCASE`).bind(value).first();
  if (exists) throw new UserError(409, `"${value}" is already on the list.`);
  await db.prepare(`INSERT INTO ${L.table} (name) VALUES (?)`).bind(value).run();
  return getManagedList(db, kind, locked);
}

// Renaming updates every listing that uses the old name, with history. Names
// the site's code or content depends on (`locked`) are refused. History rows
// are labeled "(list rename)" so research updates know the owner didn't edit
// each listing by hand (scripts/owner-edits-lib.mjs).
export async function renameListItem(db, kind, oldName, rawNew, who, locked = new Set()) {
  const L = LIST_TABLES[kind];
  const { value: newName, error } = validateListName(rawNew);
  if (error) throw new UserError(422, error);
  const found = await db.prepare(`SELECT 1 FROM ${L.table} WHERE name = ?`).bind(oldName).first();
  if (!found) throw new UserError(404, 'Not found.');
  if (newName === oldName) return getManagedList(db, kind, locked);
  if (locked.has(oldName)) {
    throw new UserError(409, `"${oldName}" can't be renamed here: the site's safety features, search words or Learn page use this exact name. Ask Claude to rename it everywhere at once.`);
  }
  const clash = await db.prepare(`SELECT 1 FROM ${L.table} WHERE name = ? COLLATE NOCASE AND name <> ?`).bind(newName, oldName).first();
  if (clash) throw new UserError(409, `"${newName}" is already on the list.`);

  const affected = L.json
    ? (await db.prepare('SELECT l.id, l.medicaid_plans FROM listings l WHERE EXISTS (SELECT 1 FROM json_each(l.medicaid_plans) j WHERE j.value = ?)').bind(oldName).all()).results
    : (await db.prepare('SELECT id FROM listings WHERE category = ?').bind(oldName).all()).results;
  const t = now();
  const by = `${who} (list rename)`;
  const stmts = [db.prepare(`INSERT INTO ${L.table} (name) VALUES (?)`).bind(newName)];
  for (const row of affected) {
    if (L.json) {
      const before = parseList(row.medicaid_plans);
      const after = before.map((p) => (p === oldName ? newName : p));
      stmts.push(db.prepare('UPDATE listings SET medicaid_plans = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(after), t, row.id));
      stmts.push(db.prepare('INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.id, 'medicaid_plans', before.join(', '), after.join(', '), by, t));
    } else {
      stmts.push(db.prepare('UPDATE listings SET category = ?, updated_at = ? WHERE id = ?').bind(newName, t, row.id));
      stmts.push(db.prepare('INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.id, 'category', oldName, newName, by, t));
    }
  }
  stmts.push(db.prepare(`DELETE FROM ${L.table} WHERE name = ?`).bind(oldName));
  await db.batch(stmts);
  return getManagedList(db, kind, locked);
}

export async function deleteListItem(db, kind, name, locked) {
  const L = LIST_TABLES[kind];
  const list = await getManagedList(db, kind, locked);
  const item = list.find((x) => x.name === name);
  if (!item) throw new UserError(404, 'Not found.');
  if (item.used > 0) throw new UserError(409, `"${name}" is used by ${item.used} listing(s). Change those listings first, or rename it instead.`);
  if (item.locked) throw new UserError(409, `"${name}" is used by the site's safety features, search words or Learn page, so it stays on the list.`);
  await db.prepare(`DELETE FROM ${L.table} WHERE name = ?`).bind(name).run();
  return getManagedList(db, kind, locked);
}

// ---- Export to Excel (admin only; includes private notes) ----

export async function exportSheets(db) {
  const [listings, history, requests] = await db.batch([
    db.prepare('SELECT * FROM listings ORDER BY name COLLATE NOCASE'),
    db.prepare('SELECT listing_id, field, old_value, new_value, changed_by, changed_at FROM listing_history ORDER BY id'),
    db.prepare('SELECT id, created_at, status, handled_note, handled_at, listing_id, fields FROM provider_requests ORDER BY id'),
  ]);
  const cols = ['id', ...EDITABLE_FIELDS, 'retired', 'created_at', 'updated_at'];
  const listingRows = listings.results.map(parseRow).map((l) =>
    cols.map((c) => (c === 'sources' ? sourcesText(l[c]) : Array.isArray(l[c]) ? l[c].join(', ') : typeof l[c] === 'boolean' ? (l[c] ? 'yes' : 'no') : l[c])));
  const requestRows = requests.results.map((r) => {
    let f = {};
    try { f = JSON.parse(r.fields); } catch { /* keep empty */ }
    return [r.id, r.created_at, r.status, f.organization ?? '', f.services ?? '', f.phone ?? '', f.email ?? '', f.website ?? '',
      f.submitter_name ?? '', f.submitter_contact ?? '', r.handled_note, r.handled_at, r.listing_id, r.fields];
  });
  return [
    { name: 'Listings', rows: [cols, ...listingRows] },
    { name: 'Change history', rows: [['listing_id', 'field', 'old_value', 'new_value', 'changed_by', 'changed_at'], ...history.results.map((h) => Object.values(h))] },
    { name: 'Provider requests', rows: [['id', 'received', 'status', 'organization', 'services', 'phone', 'email', 'website', 'submitter', 'submitter contact', 'handled note', 'handled at', 'listing id', 'all fields'], ...requestRows] },
  ];
}

// ---- Provider requests inbox ----

export async function listRequests(db) {
  const { results } = await db.prepare(
    'SELECT id, fields, status, handled_note, handled_at, listing_id, email_sent, created_at FROM provider_requests ORDER BY id DESC LIMIT 500',
  ).all();
  return results.map((r) => {
    let fields = {};
    try { fields = JSON.parse(r.fields); } catch { /* keep empty */ }
    return { ...r, fields, email_sent: Boolean(r.email_sent) };
  });
}

export async function markRequestHandled(db, id, rawNote) {
  if (!/^\d{1,10}$/.test(String(id))) throw new UserError(404, 'Request not found.');
  const note = typeof rawNote === 'string' ? rawNote.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 500) : '';
  const res = await db.prepare("UPDATE provider_requests SET status = 'Handled', handled_note = ?, handled_at = ? WHERE id = ? AND status = 'New'")
    .bind(note, now(), Number(id)).run();
  if (res.meta.changes !== 1) throw new UserError(409, 'That request was not found or was already handled.');
}

// One-tap visitor reports from the last 90 days, one row per listing, most
// reported first. Reports never change a listing; they only flag it here.
// Reports made before the owner last confirmed the listing (the time of the
// last "Verified today" or confirmed-date change) count as dealt with.
// The listing's own number comes back as `listing_phone`: `phone` is the
// count of "phone didn't work" taps, and a row can't hold both under one name.
export async function visitorReports(db, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT r.listing_id AS id, l.name, l.phone AS listing_phone, COUNT(*) AS total,
      SUM(r.reason = 'phone') AS phone, SUM(r.reason = 'closed') AS closed, SUM(r.reason = 'full') AS full, MAX(r.created_at) AS latest
    FROM listing_reports r JOIN listings l ON l.id = r.listing_id
    WHERE r.created_at > ? AND l.retired = 0
      AND r.created_at > COALESCE((SELECT MAX(h.changed_at) FROM listing_history h
        WHERE h.listing_id = l.id AND h.field = 'last_verified'), '')
    GROUP BY r.listing_id ORDER BY total DESC, latest DESC LIMIT 200`).bind(since).all();
  return results;
}
