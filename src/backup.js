// Weekly automatic backup (Phase 6). Runs from a Cron Trigger and emails the
// owner two attachments through the site's email binding:
//   - a full JSON copy of every table, which can be restored from
//   - the same Excel file as the admin "Export to Excel" button
// The email only goes to the verified support address (the binding allows no
// other destination). Nothing is stored anywhere else.

import { buildXlsx } from './xlsx.js';
import { exportSheets, todayLocal } from './db/admin.js';

const TABLES = ['categories', 'medicaid_plans', 'listings', 'listing_history', 'provider_requests', 'barrier_reports', 'help_suggestions', 'review_items', 'listing_reports'];

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function buildBackup(db) {
  const results = await db.batch(TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const tables = {};
  TABLES.forEach((t, i) => { tables[t] = results[i].results; });
  return { format: 'resource-directory-backup', version: 1, exported_at: new Date().toISOString(), tables };
}

export async function emailWeeklyBackup(env) {
  if (!env.SEND_EMAIL || !env.EMAIL_FROM || !env.FORWARD_TO) {
    console.warn('Weekly backup skipped: email is not set up yet.');
    return { sent: false };
  }
  const day = todayLocal();
  const backup = await buildBackup(env.DB);
  const json = new TextEncoder().encode(JSON.stringify(backup));
  const xlsx = buildXlsx(await exportSheets(env.DB));
  const n = backup.tables.listings.length;
  await env.SEND_EMAIL.send({
    from: env.EMAIL_FROM,
    to: env.FORWARD_TO,
    subject: `Weekly directory backup ${day} (${n} listings)`,
    text: [
      `Weekly backup of the resource directory, ${day}.`,
      '',
      `Listings: ${n}. Change history entries: ${backup.tables.listing_history.length}. Provider requests: ${backup.tables.provider_requests.length}.`,
      '',
      'Two files are attached:',
      '  - The .json file is the full backup. Keep it; Claude Code can restore from it (see HANDOFF.md).',
      '  - The .xlsx file opens in Excel for reading.',
      '',
      'These files include private notes. Keep them private and don\'t forward them.',
    ].join('\n'),
    attachments: [
      { content: toBase64(json), filename: `directory-backup-${day}.json`, type: 'application/json', disposition: 'attachment' },
      { content: toBase64(xlsx), filename: `directory-backup-${day}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: 'attachment' },
    ],
  });
  return { sent: true, listings: n };
}
