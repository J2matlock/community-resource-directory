// Rule 2: never store a domestic violence shelter's location. A DV program
// may keep only an office address, and only when the owner confirms it.

import { describe, it, expect, beforeEach } from 'vitest';
import { call, token, resetDb, countRows, validListing, validRequest, fakeEmail } from './helpers.js';

const dv = (extra = {}) => validListing({
  name: 'Practice Domestic Violence Program', category: 'Housing and Shelter', tags: ['domestic violence'],
  description: '24-hour hotline and emergency shelter.', ...extra,
});

describe('Rule 2: no domestic violence shelter locations', () => {
  beforeEach(resetDb);

  it('refuses an address on a DV program unless confirmed as an office', async () => {
    const t = await token();
    const before = await countRows('listings');
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: dv({ address: '9 Example Road, Glens Falls, NY' }) });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.address).toMatch(/office address/);
    expect(await countRows('listings')).toBe(before);
  });

  it('allows a confirmed office address', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: await token(), body: dv({ address: '9 Example Road, Glens Falls, NY', confirm_office_address: true }),
    });
    expect(res.status).toBe(201);
  });

  it('allows a DV program with a hotline and no address', async () => {
    const res = await call('/api/admin/listings', { method: 'POST', as: await token(), body: dv({ phone: '(518) 555-0120' }) });
    expect(res.status).toBe(201);
  });

  it('refuses a shelter location in private notes', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: await token(), body: dv({ private_notes: 'The shelter is located at 9 Example Road.' }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.private_notes).toBeTruthy();
  });

  it('refuses a shelter location in any field, including public ones', async () => {
    const t = await token();
    for (const extra of [
      { description: 'Our safe house on Elm Street has 10 beds.' },
      { hours: 'Shelter is located behind the church.' },
      { eligibility: 'Women; shelter at 12 Example Road' },
      { medicaid_notes: 'Safehouse location given after screening: 4 Pine Lane' },
    ]) {
      const res = await call('/api/admin/listings', { method: 'POST', as: t, body: dv(extra) });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('refuses a street address outside the address box, even with the office tick', async () => {
    const t = await token();
    for (const extra of [
      { description: 'Walk-in office at 35 Example Street, Glens Falls.' },
      { private_notes: 'Safe house 14 Maple Ave' },
      { private_notes: 'Shelter: 12 Elm St' },
    ]) {
      const res = await call('/api/admin/listings', { method: 'POST', as: t, body: dv({ ...extra, confirm_office_address: true }) });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('remembers a confirmed office address, and asks again if it changes', async () => {
    const t = await token();
    const created = await call('/api/admin/listings', {
      method: 'POST', as: t, body: dv({ address: '9 Example Road, Glens Falls, NY', confirm_office_address: true }),
    });
    const { listing } = await created.json();
    // Editing something else: no need to tick again.
    let res = await call(`/api/admin/listings/${listing.id}`, {
      method: 'PUT', as: t, body: { ...listing, hours: 'Mon–Fri 9–5', expected_updated_at: listing.updated_at },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()).listing;
    // Changing the address: must confirm again.
    res = await call(`/api/admin/listings/${listing.id}`, {
      method: 'PUT', as: t, body: { ...updated, address: '10 Other Road, Glens Falls, NY', expected_updated_at: updated.updated_at },
    });
    expect(res.status).toBe(422);
  });

  it('still allows ordinary wording like "emergency shelter" and a hotline number', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: await token(),
      body: dv({ description: '24-hour hotline, emergency shelter, counseling. Call (518) 555-0120.' }),
    });
    expect(res.status).toBe(201);
  });

  it('detects DV programs by name, tags or description', async () => {
    const t = await token();
    for (const extra of [
      { name: 'Relationship Abuse Help', tags: [], description: '' },
      { name: 'Safe Home', tags: ['DV'], description: '' },
      { name: 'Safe Home', tags: [], description: 'Help for victims of domestic violence.' },
    ]) {
      const res = await call('/api/admin/listings', {
        method: 'POST', as: t, body: validListing({ ...extra, address: '9 Example Road' }),
      });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
  });

  it('the provider form refuses a DV shelter location, and asks to confirm an office address', async () => {
    const sendReq = (extra, ip) => call('/api/requests', {
      method: 'POST', sitePublic: true, headers: { 'CF-Connecting-IP': ip }, envExtra: { SEND_EMAIL: fakeEmail().binding },
      body: validRequest({ organization: 'Practice Domestic Violence Services', ...extra }),
    });
    expect((await sendReq({ address: '9 Example Road, Glens Falls, NY' }, '192.0.2.50')).status).toBe(422);
    expect((await sendReq({ address: '', services: 'Safe house on Elm Street, 10 beds' }, '192.0.2.51')).status).toBe(422);
    expect((await sendReq({ address: '', how_to_start: 'Come to 14 Maple Ave after dark' }, '192.0.2.52')).status).toBe(422);
    expect(await countRows('provider_requests')).toBe(0);
    expect((await sendReq({ address: '9 Example Road, Glens Falls, NY', office_not_shelter: true }, '192.0.2.53')).status).toBe(201);
    expect((await sendReq({ address: '', no_public_address: true }, '192.0.2.54')).status).toBe(201);
  });

  it('an address saved before a listing became a DV program must be confirmed again', async () => {
    const t = await token();
    const created = await (await call('/api/admin/listings', {
      method: 'POST', as: t, body: validListing({ name: 'Practice Help Center', address: '9 Example Road, Glens Falls, NY' }),
    })).json();
    const l = created.listing;
    const res = await call(`/api/admin/listings/${l.id}`, {
      method: 'PUT', as: t, body: { ...l, description: 'Now runs a domestic violence program.', expected_updated_at: l.updated_at },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.address).toBeTruthy();
  });
});
