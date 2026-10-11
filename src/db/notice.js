// The site notice: one short plain-text message the owner can switch on for
// every public page, with an optional last day. Stored as a single row.

export const NOTICE_LEVELS = ['info', 'urgent'];
export const NOTICE_MAX = 280;

export async function getNotice(db) {
  const row = await db.prepare('SELECT message, level, ends_on, updated_at FROM site_notice WHERE id = 1').first();
  return row ?? { message: '', level: 'info', ends_on: '', updated_at: '' };
}

// The notice to show today, or null. `today` is YYYY-MM-DD in New York time.
export async function getActiveNotice(db, today) {
  const n = await getNotice(db);
  if (!n.message) return null;
  if (n.ends_on && n.ends_on < today) return null;
  return n;
}

export async function saveNotice(db, { message, level, ends_on }) {
  await db.prepare(`INSERT INTO site_notice (id, message, level, ends_on, updated_at) VALUES (1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET message = excluded.message, level = excluded.level, ends_on = excluded.ends_on, updated_at = excluded.updated_at`)
    .bind(message, level, ends_on).run();
  return getNotice(db);
}
