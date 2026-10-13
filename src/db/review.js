// "To review" items (admin only): decisions, checks and ideas waiting on the
// owner. Filled by scripts/seed-review.mjs; the owner answers in the admin
// panel. Never used by public routes.

import { UserError } from './admin.js';
import { validateReviewAnswer, isDvListing } from '../validate.js';

const COLUMNS = 'id, key, kind, grp, title, detail, listing_id, source, status, owner_note, sort, created_at, updated_at';

export async function listReviewItems(db) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM review_items ORDER BY sort, id`).all();
  return results;
}

export async function answerReviewItem(db, rawId, body) {
  if (!/^\d{1,10}$/.test(String(rawId))) throw new UserError(404, 'Item not found.');
  const item = await db.prepare(`SELECT ${COLUMNS} FROM review_items WHERE id = ?`).bind(Number(rawId)).first();
  if (!item) throw new UserError(404, 'Item not found.');
  // Notes on an item about a DV program also refuse street addresses (rule 2).
  let dv = /domestic violence|\bDV\b|shelter/i.test(`${item.title} ${item.grp}`);
  if (item.listing_id) {
    const l = await db.prepare('SELECT name, organization, category, description, tags FROM listings WHERE id = ?').bind(item.listing_id).first();
    if (l) dv = dv || isDvListing({ ...l, tags: JSON.parse(l.tags || '[]') });
  }
  const { value, error } = validateReviewAnswer(item.kind, body, { dv });
  if (!value) throw new UserError(422, error);
  const t = new Date().toISOString();
  await db.prepare('UPDATE review_items SET status = ?, owner_note = ?, updated_at = ? WHERE id = ?')
    .bind(value.status, value.note, t, item.id).run();
  return { ...item, status: value.status, owner_note: value.note, updated_at: t };
}
