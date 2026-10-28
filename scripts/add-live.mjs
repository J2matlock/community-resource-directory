// Add NEW listings (and any new categories) to a database. Never changes or
// removes anything already there: listings whose id or name already exist are
// skipped, so the owner's edits are safe. Each added listing gets a "created"
// history row, like an Add in the admin panel. A listing the owner asked for
// (its _src, or the file's top-level _src, starts with "owner") is recorded as
// "owner via Claude"; others as a "research import".
//   node scripts/add-live.mjs data/import/<file>.json --local
//   node scripts/add-live.mjs data/import/<file>.json --remote --owner-approved
// --remote changes the LIVE database: only after the owner says yes (CLAUDE.md).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateListing } from '../src/validate.js';
import { todayLocal } from '../src/db/admin.js';
import { OWNER_VIA_CLAUDE, isOwnerSrc } from './owner-edits-lib.mjs';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const remote = process.argv.includes('--remote');
if (!file || !file.endsWith('.json') || (!remote && !process.argv.includes('--local'))) {
  console.error('Usage: node scripts/add-live.mjs <file>.json --local | --remote --owner-approved');
  process.exit(1);
}
if (remote && !process.argv.includes('--owner-approved')) {
  console.error('Refusing: --remote changes the live database. Add --owner-approved only after the owner says yes.');
  process.exit(1);
}
const where = remote ? '--remote' : '--local';
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const query = (sql) => JSON.parse(wrangler(['d1', 'execute', 'DB', where, '--json', '--command', sql]))[0].results;

const { new_categories: newCats = [], listings, _src: fileSrc } = JSON.parse(readFileSync(file, 'utf8'));
const existing = query('SELECT id, lower(name) AS name FROM listings');
const ids = new Set(existing.map((r) => r.id));
const names = new Set(existing.map((r) => r.name));
const toAdd = listings.filter((l) => !ids.has(l.id) && !names.has(l.name.toLowerCase()));

// Same checks as an admin-panel save (client information, shelter locations,
// formats), in case the file was edited by hand after it was prepared.
const lists = {
  categories: [...new Set([...query('SELECT name FROM categories').map((r) => r.name), ...newCats])],
  plans: query('SELECT name FROM medicaid_plans').map((r) => r.name),
};
const problems = [];
for (const l of toAdd) {
  const { errors, warnings } = validateListing(l, lists);
  for (const [f, m] of Object.entries(errors)) problems.push(`${l.name}: ${f}: ${m}`);
  for (const w of warnings) problems.push(`${l.name}: ${w}`);
}
if (problems.length) {
  console.error(`NOT ADDED: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const skipped = listings.length - toAdd.length;
if (!toAdd.length) { console.log(`Nothing to add (${skipped} already there).`); process.exit(0); }

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const JSON_COLS = ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans', 'sources'];
const COLS = ['id', 'name', 'organization', 'category', ...JSON_COLS, 'phone', 'fax', 'email', 'website', 'address', 'town',
  'hours', 'eligibility', 'medicaid_notes', 'description', 'private_notes', 'status', 'review_by', 'visibility', 'last_verified', 'last_checked_online', 'retired'];
const who = (l) => q(isOwnerSrc(l._src ?? fileSrc) ? `${OWNER_VIA_CLAUDE} ${todayLocal()}` : `research import ${todayLocal()}`);
const sql = [
  ...newCats.map((c) => `INSERT OR IGNORE INTO categories (name) VALUES (${q(c)});`),
  ...toAdd.flatMap((l) => [
    `INSERT INTO listings (${COLS.join(', ')}) VALUES (${COLS.map((c) =>
      JSON_COLS.includes(c) ? q(JSON.stringify(l[c] ?? [])) : c === 'retired' ? 0 : q(l[c])).join(', ')});`,
    `INSERT INTO listing_history (listing_id, field, old_value, new_value, changed_by) VALUES (${q(l.id)}, 'created', '', ${q(l.name)}, ${who(l)});`,
  ]),
];
// Holds private notes, so it stays under data/ (git-ignored).
const sqlFile = file.replace(/\.json$/, `${remote ? '-live' : '-local'}.sql`);
writeFileSync(sqlFile, sql.join('\n') + '\n');
wrangler(['d1', 'execute', 'DB', where, ...(remote ? ['--yes'] : []), '--file', sqlFile]);

const [after] = query("SELECT COUNT(*) AS n, SUM(visibility = 'Public' AND retired = 0) AS pub FROM listings");
console.log(`Added ${toAdd.length} listings (${skipped} skipped as already there). ${remote ? 'Live' : 'Local'} database now has ${after.n} listings (${after.pub} public).`);
