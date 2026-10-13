// Turn a weekly backup file (.json from the backup email) into SQL that can be
// loaded into a NEW, empty database (after migrations) to check it before
// switching over. Covers every table the backup holds: the managed lists,
// listings with their visitor reports and change history, provider requests,
// barrier reports, help suggestions, "To review" items and the site notice.
// The migrations already create the notice row, so that one is replaced
// rather than added. Never run the output against the live database without
// the owner's explicit yes.
//   node scripts/backup-to-sql.mjs path/to/directory-backup-YYYY-MM-DD.json > backups/restore.sql
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/backup-to-sql.mjs <backup.json>'); process.exit(1); }
const backup = JSON.parse(readFileSync(path, 'utf8'));
if (backup.format !== 'resource-directory-backup') { console.error('This is not a directory backup file.'); process.exit(1); }

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
// Tables that others point to come first (listings need their categories).
const order = ['categories', 'medicaid_plans', 'listings', 'listing_reports', 'listing_history', 'provider_requests',
  'barrier_reports', 'help_suggestions', 'review_items', 'site_notice'];
const out = [];
for (const t of order) {
  const verb = t === 'site_notice' ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
  for (const row of backup.tables[t] || []) {
    const cols = Object.keys(row);
    out.push(`${verb} ${t} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
  }
}
process.stdout.write(out.join('\n') + '\n');
console.error(`Wrote ${out.length} rows from the backup of ${backup.exported_at}.`);
