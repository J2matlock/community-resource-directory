// Rule 4: private data never reaches the public. Public responses contain
// only public fields, never Internal or retired listings, even for the owner.

import { describe, it, expect, beforeEach } from 'vitest';
import { call, token, resetDb, validListing } from './helpers.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';
import { PUBLIC_COLUMNS } from '../src/db/public.js';
import { PUBLIC_FIELDS, PRIVATE_FIELDS } from '../src/lib/listing-rules.js';

describe('Rule 4: private data never reaches the public', () => {
  beforeEach(resetDb);

  it('the public query selects only public columns', () => {
    for (const f of PRIVATE_FIELDS) expect(PUBLIC_COLUMNS).not.toContain(f);
    expect([...PUBLIC_COLUMNS].sort()).toEqual([...PUBLIC_FIELDS].sort());
  });

  for (const asOwner of [false, true]) {
    it(`public listings contain no private fields or listings (${asOwner ? 'logged in as owner' : 'logged out'})`, async () => {
      const res = await call('/api/listings', { sitePublic: true, as: asOwner ? await token() : null });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(PRIVATE_MARKER);
      expect(text).not.toContain('private_notes');
      expect(text).not.toContain('visibility');
      expect(text).not.toContain('retired');
      expect(text).not.toContain('Pat Example');

      const data = JSON.parse(text);
      const ids = data.listings.map((l) => l.id);
      expect(ids).toEqual(['sample-dental-clinic', 'sample-food-pantry', 'sample-legal-help']);
      for (const l of data.listings) expect(Object.keys(l).sort()).toEqual([...PUBLIC_FIELDS].sort());
    });
  }

  it('a listing made Internal disappears from the public list at once', async () => {
    const t = await token();
    const current = await (await call('/api/admin/listings/sample-food-pantry', { as: t })).json();
    const res = await call('/api/admin/listings/sample-food-pantry', {
      method: 'PUT', as: t,
      body: { ...current.listing, visibility: 'Internal', expected_updated_at: current.listing.updated_at },
    });
    expect(res.status).toBe(200);
    const pub = await (await call('/api/listings', { sitePublic: true })).json();
    expect(pub.listings.map((l) => l.id)).not.toContain('sample-food-pantry');
  });

  it('a retired listing disappears from the public list, and comes back when restored', async () => {
    const t = await token();
    await call('/api/admin/listings/sample-food-pantry/retire', { method: 'POST', as: t });
    let pub = await (await call('/api/listings', { sitePublic: true })).json();
    expect(pub.listings.map((l) => l.id)).not.toContain('sample-food-pantry');
    await call('/api/admin/listings/sample-food-pantry/restore', { method: 'POST', as: t });
    pub = await (await call('/api/listings', { sitePublic: true })).json();
    expect(pub.listings.map((l) => l.id)).toContain('sample-food-pantry');
  });

  it('private notes saved by the owner never show publicly', async () => {
    const t = await token();
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ private_notes: `${PRIVATE_MARKER} new note` }) });
    expect(res.status).toBe(201);
    const text = await (await call('/api/listings', { sitePublic: true })).text();
    expect(text).toContain('New Practice Listing');
    expect(text).not.toContain(PRIVATE_MARKER);
  });

  it('the admin listing endpoint is not reachable from the public site', async () => {
    const res = await call('/api/admin/listings', { sitePublic: true });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(PRIVATE_MARKER);
  });

  it('category and plan names used only by hidden listings stay private', async () => {
    const t = await token();
    await call('/api/admin/lists/categories', { method: 'POST', as: t, body: { name: 'Hidden Staff Contacts' } });
    const current = await (await call('/api/admin/listings/sample-internal-contacts', { as: t })).json();
    await call('/api/admin/listings/sample-internal-contacts', {
      method: 'PUT', as: t,
      body: { ...current.listing, category: 'Hidden Staff Contacts', medicaid_plans: ['United Healthcare'], expected_updated_at: current.listing.updated_at },
    });
    const pub = await (await call('/api/listings', { sitePublic: true })).json();
    expect(pub.categories).not.toContain('Hidden Staff Contacts');
    expect(pub.categories).not.toContain('Housing and Shelter'); // only Internal and retired listings use it
    expect(pub.medicaid_plans).not.toContain('United Healthcare');
    expect(pub.categories).toEqual(['Dental', 'Food', 'Legal Help']);
  });

  it('a listing page link serves the directory page, not data', async () => {
    const res = await call('/listing/sample-internal-contacts', { sitePublic: true });
    expect(await res.text()).not.toContain(PRIVATE_MARKER);
  });
});
