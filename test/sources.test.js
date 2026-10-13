// Listing sources: up to 3 public links that back up a listing, shown as
// "Source" on the card. They are public text, so they get the same checks.

import { describe, it, expect, beforeEach } from 'vitest';
import { call, token, resetDb, validListing } from './helpers.js';

const src = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://example.org/page${i}`, label: `Page ${i}`, seen: '2026-10-11' }));

describe('Listing sources', () => {
  beforeEach(resetDb);

  it('saves up to 3 sources and shows them publicly', async () => {
    const t = await token();
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Sourced Pantry', sources: src(2) }) });
    expect(res.status).toBe(201);
    const pub = await (await call('/api/listings', { sitePublic: true })).json();
    const l = pub.listings.find((x) => x.name === 'Sourced Pantry');
    expect(l.sources).toEqual(src(2));
  });

  it('refuses more than 3 sources, non-web links and bad dates', async () => {
    const t = await token();
    for (const sources of [
      src(4),
      [{ url: 'javascript:alert(1)', label: 'x', seen: '' }],
      [{ url: 'data:text/html,hi', label: 'x', seen: '' }],
      [{ url: 'https://example.org', label: 'x', seen: 'last week' }],
      [{ url: 'http://example.org', label: 'x', seen: '' }],
      [{ url: 'https://user:pass@example.org', label: 'x', seen: '' }],
      'https://example.org',
    ]) {
      const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Bad Sources', sources }) });
      expect(res.status).toBe(422);
      expect((await res.json()).errors.sources).toBeTruthy();
    }
  });

  it('refuses client information in a source label', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: await token(),
      body: validListing({ name: 'Label Check', sources: [{ url: 'https://example.org', label: 'DOB: 01/02/1990', seen: '' }] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.sources).toBeTruthy();
  });

  it('refuses client information hidden in a source web address', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: await token(),
      body: validListing({ name: 'URL Check', sources: [{ url: 'https://example.org/?note=DOB:01-02-1990', label: 'Page', seen: '' }] }),
    });
    expect(res.status).toBe(422);
  });

  it('records source changes in the listing history', async () => {
    const t = await token();
    const cur = await (await call('/api/admin/listings/sample-food-pantry', { as: t })).json();
    const res = await call('/api/admin/listings/sample-food-pantry', {
      method: 'PUT', as: t, body: { ...cur.listing, sources: src(1), expected_updated_at: cur.listing.updated_at },
    });
    expect(res.status).toBe(200);
    const { history } = await (await call('/api/admin/listings/sample-food-pantry', { as: t })).json();
    const h = history.find((x) => x.field === 'sources');
    expect(h.new_value).toContain('https://example.org/page0');
  });
});
