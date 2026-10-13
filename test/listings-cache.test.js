// The public listings data carries a fingerprint (ETag). A browser that sends
// it back and already has this exact copy gets a tiny "not changed" (304)
// reply instead of the whole list; after an admin edit the fingerprint
// changes, so the new list is sent. Rule 4 still holds: a 304 has no body.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, validListing } from './helpers.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';

describe('Public listings: not changed (304)', () => {
  beforeEach(resetDb);

  it('a GET returns an ETag and tells browsers to check every time', async () => {
    const res = await call('/api/listings', { sitePublic: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('the same copy asked for again answers 304 with no body', async () => {
    const first = await call('/api/listings', { sitePublic: true });
    const etag = first.headers.get('ETag');
    const again = await call('/api/listings', { sitePublic: true, headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(again.headers.get('Cache-Control')).toBe('no-cache');
    const body = await again.text();
    expect(body).toBe('');
    expect(body).not.toContain(PRIVATE_MARKER);
    // Browsers may send several, or a strong form of the tag; both still match.
    const list = await call('/api/listings', { sitePublic: true, headers: { 'If-None-Match': `"other", ${etag.replace(/^W\//, '')}` } });
    expect(list.status).toBe(304);
  });

  it('after an admin edit the ETag changes and the old one no longer matches', async () => {
    const first = await call('/api/listings', { sitePublic: true });
    const old = first.headers.get('ETag');
    const saved = await call('/api/admin/listings/sample-food-pantry', { method: 'PUT', as: await token(), body: validListing({ name: 'Renamed Pantry' }) });
    expect(saved.status).toBe(200);
    const after = await call('/api/listings', { sitePublic: true, headers: { 'If-None-Match': old } });
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(old);
    expect(await after.text()).toContain('Renamed Pantry');
  });

  it('works the same way through the Cloudflare cache copy', async () => {
    const on = { sitePublic: true, envExtra: { PUBLIC_CACHE: 'on' } };
    const first = await call('/api/listings', on);
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\/"/);
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    // The next answers must come from Cloudflare's copy: no listings read
    // from the database, whether the browser sends the fingerprint or not.
    const spy = vi.spyOn(env.DB, 'prepare');
    const hit = await call('/api/listings', { ...on, headers: { 'If-None-Match': etag } });
    expect(hit.status).toBe(304);
    expect(await hit.text()).toBe('');
    const full = await call('/api/listings', on);
    expect(full.status).toBe(200);
    expect(full.headers.get('ETag')).toBe(etag);
    expect(await full.text()).toBe(await first.text());
    const listingReads = spy.mock.calls.filter(([sql]) => /FROM listings/.test(sql)).length;
    spy.mockRestore();
    expect(listingReads).toBe(0);
  });
});
