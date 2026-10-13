// One-tap "This didn't work" reports (owner decision, 2026-10-12): anonymous,
// tap-only, spam-checked, never shown publicly, never change a listing, and
// only the owner sees them (on the re-check page).

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows } from './helpers.js';

let ipCounter = 0;
function report(body, opts = {}) {
  return call('/api/listing-reports', {
    method: 'POST', sitePublic: true,
    headers: { 'CF-Connecting-IP': opts.ip ?? `198.51.100.${++ipCounter}` },
    body: { listing_id: 'sample-food-pantry', reason: 'phone', nickname: '', turnstile_token: 'pass-token:report', ...body },
  });
}

describe('One-tap listing reports', () => {
  beforeEach(resetDb);

  it('saves only the listing and the reason, and never changes the listing', async () => {
    const before = await env.DB.prepare("SELECT * FROM listings WHERE id = 'sample-food-pantry'").first();
    const res = await report({ reason: 'closed', comment: 'my client John Smith', email: 'x@example.org' });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT * FROM listing_reports').first();
    expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'listing_id', 'reason']);
    expect(row).toMatchObject({ listing_id: 'sample-food-pantry', reason: 'closed' });
    expect(await env.DB.prepare("SELECT * FROM listings WHERE id = 'sample-food-pantry'").first()).toEqual(before);
  });

  it('refuses unknown reasons, bad ids and a failed human check', async () => {
    expect((await report({ reason: 'other' })).status).toBe(422);
    expect((await report({ listing_id: '<script>' })).status).toBe(422);
    expect((await report({ turnstile_token: 'fail' })).status).toBe(403);
    expect((await report({ turnstile_token: 'pass-token:request' })).status).toBe(403);
    expect(await countRows('listing_reports')).toBe(0);
  });

  it('takes nothing for hidden or retired listings, without saying so', async () => {
    const res = await report({ listing_id: 'sample-retired-shelter' });
    expect(res.status).toBe(200);
    expect((await report({ listing_id: 'no-such-listing' })).status).toBe(200);
    expect(await countRows('listing_reports')).toBe(0);
  });

  it('limits each sender per hour', async () => {
    for (let i = 0; i < 5; i++) expect((await report({}, { ip: '203.0.113.60' })).status).toBe(201);
    expect((await report({}, { ip: '203.0.113.60' })).status).toBe(429);
  });

  it('stores at most 3 reports per listing per hour', async () => {
    for (let i = 0; i < 5; i++) expect([200, 201]).toContain((await report({})).status);
    expect(await countRows('listing_reports')).toBe(3);
  });

  it('only the owner sees reports, on the re-check page; nothing public shows them', async () => {
    await report({ reason: 'phone' });
    await report({ reason: 'phone' });
    const pub = await (await call('/api/listings', { sitePublic: true })).text();
    expect(pub).not.toContain('listing_reports');
    expect(pub).not.toMatch(/"reported"|"reports"/);
    expect((await call('/api/admin/recheck', { sitePublic: true })).status).not.toBe(200);
    const { reported } = await (await call('/api/admin/recheck', { as: await token() })).json();
    expect(reported[0]).toMatchObject({ id: 'sample-food-pantry', total: 2, phone: 2 });
  });

  it('keeps the listing\'s own phone number next to the counts (the count must not overwrite it)', async () => {
    await report({ reason: 'phone' });
    const { reported } = await (await call('/api/admin/recheck', { as: await token() })).json();
    expect(reported[0].listing_phone).toBe('(518) 555-0101');
    expect(reported[0].phone).toBe(1); // how many "phone didn't work" taps
    expect(reported[0]).toMatchObject({ id: 'sample-food-pantry', total: 1, closed: 0, full: 0 });
  });
});
