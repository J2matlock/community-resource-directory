// Apply researched field updates to existing listings, like admin-panel saves.
//   node scripts/update-live.mjs data/import/<updates>.json --local
//   node scripts/update-live.mjs data/import/<updates>.json --remote --owner-approved
// The updates file: { updates: { <id>: { <field>: <value>, _src, _base_updated_at } }, retire: [<id>, ...] }.
// Retiring hides a listing from the public but keeps it (admin "Show retired"), like the Retire button.
// Every save goes through the same checks as the admin panel and writes one
// history row per changed field. With --remote, a listing is only changed if
// it hasn't been edited since the research snapshot (_base_updated_at), so the
// owner's own edits are never overwritten. --remote changes the LIVE database:
// only after the owner says yes (CLAUDE.md).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateListing, isDvListing } from '../src/validate.js';
import { EDITABLE_FIELDS } from '../src/db/admin.js';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const remote = process.argv.includes('--remote');
if (!file || !file.endsWith('.json') || (!remote && !process.argv.includes('--local'))) {
  console.error('Usage: node scripts/update-live.mjs <updates>.json --local | --remote --owner-approved');
  process.exit(1);
}
if (remote && !process.argv.includes('--owner-approved')) {
  console.error('Refusing: --remote changes the live database. Add --owner-approved only after the owner says yes.');
  process.exit(1);
}
const where = remote ? '--remote' : '--local';
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const query = (sql) => JSON.parse(wrangler(['d1', 'execute', 'DB', where, '--json', '--command', sql]))[0].results;

const JSON_COLUMNS = ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans'];
const toDb = (f, v) => (JSON_COLUMNS.includes(f) ? JSON.stringify(v ?? []) : v ?? '');
const historyValue = (f, v) => (JSON_COLUMNS.includes(f) ? (v ?? []).join(', ') : String(v ?? ''));
const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;

const { updates = {}, retire = [] } = JSON.parse(readFileSync(file, 'utf8'));
const lists = {
  categories: query('SELECT name FROM categories').map((r) => r.name),
  plans: query('SELECT name FROM medicaid_plans').map((r) => r.name),
};
const rows = new Map(query('SELECT * FROM listings').map((r) => [r.id, r]));
const who = `research update ${new Date().toISOString().slice(0, 10)}`;
const t = new Date().toISOString();

const sql = [];
const report = { changed: [], unchanged: [], skippedEdited: [], skippedMissing: [], problems: [] };
for (const [id, raw] of Object.entries(updates)) {
  const row = rows.get(id);
  if (!row || row.retired) { report.skippedMissing.push(id); continue; }
  if (remote && raw._base_updated_at && row.updated_at !== raw._base_updated_at) { report.skippedEdited.push(id); continue; }
  const existing = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSON_COLUMNS.includes(k) ? JSON.parse(v || '[]') : v]));
  const fields = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
  const input = { ...Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, existing[f]])), ...fields };
  const opts = { confirmedAddress: isDvListing(existing) && existing.address ? existing.address : undefined };
  const { value, errors, warnings } = validateListing(input, lists, opts);
  if (Object.keys(errors).length || warnings.length) {
    report.problems.push(`${id}: ${JSON.stringify(errors)} ${warnings.join('; ')}`);
    continue;
  }
  const changed = EDITABLE_FIELDS.filter((f) => f in fields && historyValue(f, value[f]) !== historyValue(f, existing[f]));
  if (!changed.length) { report.unchanged.push(id); continue; }
  sql.push(`UPDATE listings SET ${changed.map((f) => `${f} = ${q(toDb(f, value[f]))}`).join(', ')}, updated_at = ${q(t)} WHERE id = ${q(id)} AND updated_at = ${q(row.updated_at)};`);
  for (const f of changed) {
    sql.push(`INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) SELECT ${q(id)}, ${q(f)}, ${q(historyValue(f, existing[f]))}, ${q(historyValue(f, value[f]))}, ${q(who)}, ${q(t)} WHERE changes() = 1;`);
  }
  report.changed.push(`${id} (${changed.join(', ')})`);
}

for (const id of retire) {
  const row = rows.get(id);
  if (!row) { report.skippedMissing.push(id); continue; }
  if (row.retired) { report.unchanged.push(id); continue; }
  sql.push(`UPDATE listings SET retired = 1, updated_at = ${q(t)} WHERE id = ${q(id)} AND updated_at = ${q(row.updated_at)};`);
  sql.push(`INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by, changed_at) SELECT ${q(id)}, 'retired', 'no', 'yes', ${q(who)}, ${q(t)} WHERE changes() = 1;`);
  report.changed.push(`${id} (retired)`);
}

if (report.problems.length) {
  console.error(`NOT APPLIED: ${report.problems.length} listing(s) failed the checks:`);
  for (const p of report.problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (sql.length) {
  // Holds listing text, so it stays under data/ (git-ignored).
  const sqlFile = file.replace(/\.json$/, `${remote ? '-live' : '-local'}.sql`);
  writeFileSync(sqlFile, sql.join('\n') + '\n');
  wrangler(['d1', 'execute', 'DB', where, ...(remote ? ['--yes'] : []), '--file', sqlFile]);
}
console.log(`${remote ? 'Live' : 'Local'}: ${report.changed.length} listings updated, ${report.unchanged.length} already up to date, ${report.skippedEdited.length} skipped (edited since the snapshot), ${report.skippedMissing.length} not found or retired.`);
if (report.skippedEdited.length) console.log(`Skipped because they were edited since the snapshot: ${report.skippedEdited.join(', ')}`);
if (process.argv.includes('--verbose')) for (const c of report.changed) console.log(`  ${c}`);
