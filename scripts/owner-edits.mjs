// List the fields the owner set last, per listing, from a backup (npm run backup).
// /refresh-info reads this before researching: these fields are never changed
// by research; a disagreeing source becomes a call-list question instead.
//   node scripts/owner-edits.mjs backups/<file>.sql [--json <out>.json]
// Reads the backup file only (no network, no database). Private note text is
// not printed.

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ownerSetFields } from './owner-edits-lib.mjs';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const jsonAt = process.argv.indexOf('--json');
const out = jsonAt > 0 ? process.argv[jsonAt + 1] : null;
if (!file || !file.endsWith('.sql')) {
  console.error('Usage: node scripts/owner-edits.mjs backups/<file>.sql [--json <out>.json]');
  process.exit(1);
}

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(file, 'utf8'));
const owned = ownerSetFields(db.prepare('SELECT id, listing_id, field, new_value, changed_by, changed_at FROM listing_history').all());
const shown = (f, v) => (f === 'private_notes' ? '(private)' : v);

const result = Object.fromEntries([...owned].sort(([a], [b]) => a.localeCompare(b)).map(([id, fields]) =>
  [id, Object.fromEntries([...fields].map(([f, { value, at }]) => [f, { value: shown(f, value), at: at.slice(0, 10) }]))]));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
const count = Object.values(result).reduce((n, f) => n + Object.keys(f).length, 0);
console.log(`${Object.keys(result).length} listings have ${count} field(s) the owner set last. Research leaves these alone.`);
if (!out) for (const [id, fields] of Object.entries(result)) console.log(`  ${id}: ${Object.keys(fields).join(', ')}`);
