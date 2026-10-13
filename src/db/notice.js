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

// Emergency pause (admin switch). The SITE_PAUSED setting is a backup switch
// that works even if the database can't be reached. The answer is kept for 30
// seconds (fewer database reads), and a database error keeps the last answer
// instead of un-pausing.
let pauseMemo = { value: false, at: 0 };
/** Forget the remembered answer (tests). */
export function forgetPauseMemo() { pauseMemo = { value: false, at: 0 }; }
export async function isPaused(env, { fresh = false } = {}) {
  if (env.SITE_PAUSED === 'true') return true;
  if (!fresh && Date.now() - pauseMemo.at < 30_000) return pauseMemo.value;
  try {
    const row = await env.DB.prepare('SELECT paused FROM site_notice WHERE id = 1').first();
    pauseMemo = { value: Boolean(row?.paused), at: Date.now() };
  } catch {
    pauseMemo.at = Date.now();
  }
  return pauseMemo.value;
}

export async function setPaused(db, paused) {
  await db.prepare(`INSERT INTO site_notice (id, paused, updated_at) VALUES (1, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`).bind(paused ? 1 : 0).run();
  const row = await db.prepare('SELECT paused FROM site_notice WHERE id = 1').first();
  pauseMemo = { value: Boolean(row?.paused), at: Date.now() };
  return pauseMemo.value;
}
