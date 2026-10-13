// "To review" (admin only): the owner answers decisions, checks and ideas.
// Items never reach public routes, and answers are checked like other input.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb } from './helpers.js';

async function seed() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO review_items (key, kind, grp, title, detail) VALUES ('k1', 'decision', 'Decisions', 'Keep the footer line?', 'PRIVATE-REVIEW-MARKER')"),
    env.DB.prepare("INSERT INTO review_items (key, kind, grp, title, listing_id) VALUES ('k2', 'call', 'Call list', 'Call the pantry', 'sample-food-pantry')"),
  ]);
  const { results } = await env.DB.prepare('SELECT id, key FROM review_items ORDER BY id').all();
  return Object.fromEntries(results.map((r) => [r.key, r.id]));
}

describe('To review', () => {
  beforeEach(resetDb);

  it('lists items for the owner and saves an answer with a note', async () => {
    const ids = await seed();
    const t = await token();
    const list = await (await call('/api/admin/review', { as: t })).json();
    expect(list.items.map((i) => i.title)).toEqual(['Keep the footer line?', 'Call the pantry']);
    const res = await call(`/api/admin/review/${ids.k1}`, { method: 'POST', as: t, body: { status: 'yes', note: 'Keep it.' } });
    expect(res.status).toBe(200);
    expect((await res.json()).item).toMatchObject({ status: 'yes', owner_note: 'Keep it.' });
    const back = await call(`/api/admin/review/${ids.k1}`, { method: 'POST', as: t, body: { status: 'open', note: '' } });
    expect((await back.json()).item.status).toBe('open');
  });

  it('only accepts answers that fit the kind of item', async () => {
    const ids = await seed();
    const t = await token();
    expect((await call(`/api/admin/review/${ids.k1}`, { method: 'POST', as: t, body: { status: 'done' } })).status).toBe(422);
    expect((await call(`/api/admin/review/${ids.k2}`, { method: 'POST', as: t, body: { status: 'yes' } })).status).toBe(422);
    expect((await call(`/api/admin/review/${ids.k2}`, { method: 'POST', as: t, body: { status: 'done' } })).status).toBe(200);
    expect((await call('/api/admin/review/999999', { method: 'POST', as: t, body: { status: 'done' } })).status).toBe(404);
  });

  it('refuses client information in a note', async () => {
    const ids = await seed();
    const res = await call(`/api/admin/review/${ids.k1}`, { method: 'POST', as: await token(), body: { status: 'yes', note: 'Client DOB: 01/02/1990' } });
    expect(res.status).toBe(422);
  });

  it('refuses a shelter location in a note, and street addresses on DV items', async () => {
    const ids = await seed();
    const t = await token();
    const r1 = await call(`/api/admin/review/${ids.k2}`, { method: 'POST', as: t, body: { status: 'done', note: 'The shelter is located at 12 Elm Street.' } });
    expect(r1.status).toBe(422);
    await env.DB.prepare("INSERT INTO review_items (key, kind, grp, title) VALUES ('k3', 'call', 'Call list', 'Domestic violence hotline hours')").run();
    const id3 = (await env.DB.prepare("SELECT id FROM review_items WHERE key = 'k3'").first()).id;
    const r2 = await call(`/api/admin/review/${id3}`, { method: 'POST', as: t, body: { status: 'done', note: 'They moved to 12 Elm Street' } });
    expect(r2.status).toBe(422);
    const r3 = await call(`/api/admin/review/${id3}`, { method: 'POST', as: t, body: { status: 'done', note: 'Hotline hours confirmed.' } });
    expect(r3.status).toBe(200);
  });

  it('never shows review items on public routes', async () => {
    await seed();
    for (const path of ['/api/listings', '/', '/learn', '/sitemap.xml']) {
      const res = await call(path, { sitePublic: true });
      expect(await res.text()).not.toContain('PRIVATE-REVIEW-MARKER');
    }
  });
});
