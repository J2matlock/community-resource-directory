// Admin saves: checks before saving, change history, Verified today,
// Retire/Restore, Due for re-check, and managed lists.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, validListing, countRows, OWNER } from './helpers.js';
import { todayLocal, dueForRecheck } from '../src/db/admin.js';

async function getListing(t, id) {
  return (await call(`/api/admin/listings/${id}`, { as: t })).json();
}

describe('Admin saves', () => {
  let t;
  beforeEach(async () => {
    await resetDb();
    t = await token();
  });

  it('creates a listing with a link-friendly id and cleaned values', async () => {
    // Same name as a sample listing: the owner confirms the duplicate warning.
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Sample Food Pantry', confirm_warnings: true }) });
    expect(res.status).toBe(201);
    const { listing } = await res.json();
    expect(listing.id).toBe('sample-food-pantry-2');
    expect(listing.phone).toBe('(518) 555-0110');
    expect(listing.website).toBe('https://example.org');
    const { history } = await getListing(t, listing.id);
    expect(history[0]).toMatchObject({ field: 'created', changed_by: OWNER });
  });

  it('checks required fields, phone, website and lists', async () => {
    const res = await call('/api/admin/listings', {
      method: 'POST', as: t,
      body: validListing({ name: '', category: 'Nope', phone: '555', website: 'javascript:alert(1)', serves_counties: ['Mars'], status: 'Open' }),
    });
    expect(res.status).toBe(422);
    const { errors } = await res.json();
    expect(Object.keys(errors).sort()).toEqual(['category', 'name', 'phone', 'serves_counties', 'status', 'website']);
  });

  it('refuses a date that is not on the calendar, like April 31', async () => {
    const bad = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ last_verified: '2026-04-31' }) });
    expect(bad.status).toBe(422);
    expect((await bad.json()).errors.last_verified).toBeTruthy();
    const ok = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ last_verified: '2026-04-30' }) });
    expect(ok.status).toBe(201);
  });

  it('refuses a huge request body even without a size header', async () => {
    const { default: worker } = await import('../src/index.js');
    const big = new ReadableStream({
      start(c) { for (let i = 0; i < 30; i++) c.enqueue(new TextEncoder().encode('x'.repeat(10_000))); c.close(); },
    });
    const req = new Request('https://directory.example.test/api/admin/listings', {
      method: 'POST', body: big, duplex: 'half',
      headers: { 'Cf-Access-Jwt-Assertion': t, Origin: 'https://directory.example.test', 'Content-Type': 'application/json' },
    });
    const res = await worker.fetch(req, { ...env, SITE_PUBLIC: 'false' });
    expect(res.status).toBe(413);
  });

  it('refuses text that is too long', async () => {
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ description: 'x'.repeat(4001) }) });
    expect(res.status).toBe(422);
  });

  it('stores typed HTML as plain text, unchanged', async () => {
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ description: '<script>alert(1)</script>' }) });
    const { listing } = await res.json();
    expect(listing.description).toBe('<script>alert(1)</script>');
    const pub = await call('/api/listings', { sitePublic: true });
    expect(pub.headers.get('Content-Type')).toMatch(/application\/json/);
  });

  it('warns about private-looking text in public fields until confirmed', async () => {
    const body = validListing({ description: 'Ask for Jamie at the front desk.' });
    let res = await call('/api/admin/listings', { method: 'POST', as: t, body });
    expect(res.status).toBe(422);
    expect((await res.json()).warnings.length).toBe(1);
    res = await call('/api/admin/listings', { method: 'POST', as: t, body: { ...body, confirm_warnings: true } });
    expect(res.status).toBe(201);
  });

  it('records one history row per changed field', async () => {
    const { listing } = await getListing(t, 'sample-food-pantry');
    const res = await call('/api/admin/listings/sample-food-pantry', {
      method: 'PUT', as: t,
      body: { ...listing, phone: '(518) 555-0150', tags: ['food pantry', 'groceries', 'food'], expected_updated_at: listing.updated_at },
    });
    expect(res.status).toBe(200);
    const { history } = await getListing(t, 'sample-food-pantry');
    expect(history.map((h) => h.field).sort()).toEqual(['phone', 'tags']);
    const phone = history.find((h) => h.field === 'phone');
    expect(phone).toMatchObject({ old_value: '(518) 555-0101', new_value: '(518) 555-0150', changed_by: OWNER });
  });

  it('refuses a stale edit from another tab and writes no history', async () => {
    const { listing } = await getListing(t, 'sample-food-pantry');
    await call('/api/admin/listings/sample-food-pantry', { method: 'PUT', as: t, body: { ...listing, hours: 'First edit', expected_updated_at: listing.updated_at } });
    const res = await call('/api/admin/listings/sample-food-pantry', { method: 'PUT', as: t, body: { ...listing, hours: 'Stale edit', expected_updated_at: listing.updated_at } });
    expect(res.status).toBe(409);
    const after = await getListing(t, 'sample-food-pantry');
    expect(after.listing.hours).toBe('First edit');
    expect(after.history.filter((h) => h.new_value === 'Stale edit')).toEqual([]);
  });

  it('"Verified today" sets today\'s date and records it', async () => {
    const res = await call('/api/admin/listings/sample-dental-clinic/verify', { method: 'POST', as: t });
    expect((await res.json()).listing.last_verified).toBe(todayLocal());
    const { history } = await getListing(t, 'sample-dental-clinic');
    expect(history[0]).toMatchObject({ field: 'last_verified', new_value: todayLocal() });
  });

  it('retire and restore are recorded in history', async () => {
    await call('/api/admin/listings/sample-food-pantry/retire', { method: 'POST', as: t });
    await call('/api/admin/listings/sample-food-pantry/restore', { method: 'POST', as: t });
    const { listing, history } = await getListing(t, 'sample-food-pantry');
    expect(listing.retired).toBe(false);
    expect(history.map((h) => `${h.field}:${h.new_value}`)).toEqual(['retired:no', 'retired:yes']);
  });

  it('"Due for re-check" uses tiers: food and shelter every 3 months, others yearly', async () => {
    // Food pantry confirmed 2026-01-15 (due 2026-04-15); legal help confirmed
    // 2025-09-01 (due 2026-09-01); dental never checked; review date 2026-11-01.
    let due = (await dueForRecheck(env.DB, '2026-02-01')).map((l) => l.id);
    expect(due).toContain('sample-dental-clinic'); // never checked
    expect(due).toContain('sample-internal-contacts'); // never checked
    expect(due).not.toContain('sample-food-pantry');
    expect(due).not.toContain('sample-legal-help');
    expect(due).not.toContain('sample-retired-shelter');
    due = (await dueForRecheck(env.DB, '2026-05-01')).map((l) => l.id);
    expect(due).toContain('sample-food-pantry'); // 3-month tier
    expect(due).not.toContain('sample-legal-help'); // yearly tier
    due = (await dueForRecheck(env.DB, '2026-12-01')).map((l) => l.id);
    expect(due).toContain('sample-legal-help');
    expect(due[0]).toBe('sample-dental-clinic'); // past its re-check-by date comes first
  });

  it('a recent online check counts as checked', async () => {
    await env.DB.prepare("UPDATE listings SET last_checked_online = '2026-01-20' WHERE id = 'sample-dental-clinic'").run();
    const due = (await dueForRecheck(env.DB, '2026-02-01')).map((l) => l.id);
    expect(due).not.toContain('sample-dental-clinic');
  });

  it('renaming a category updates its listings, with history', async () => {
    await call('/api/admin/lists/categories', { method: 'POST', as: t, body: { name: 'Bike Repair' } });
    const made = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Practice Bike Shop', category: 'Bike Repair' }) });
    const { listing: bike } = await made.json();
    const res = await call('/api/admin/lists/categories/Bike%20Repair', { method: 'PUT', as: t, body: { name: 'Bikes and Repair' } });
    expect(res.status).toBe(200);
    const { listing, history } = await getListing(t, bike.id);
    expect(listing.category).toBe('Bikes and Repair');
    expect(history[0]).toMatchObject({ field: 'category', old_value: 'Bike Repair', new_value: 'Bikes and Repair' });
  });

  it('won\'t rename a category or plan the site\'s code or search words depend on', async () => {
    for (const name of ['Food', 'Housing and Shelter', 'Dental']) {
      const res = await call(`/api/admin/lists/categories/${encodeURIComponent(name)}`, { method: 'PUT', as: t, body: { name: `${name} Renamed` } });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/can't be renamed here/);
    }
    const plan = await call('/api/admin/lists/plans/Medicaid%20(call%20to%20check%20plan)', { method: 'PUT', as: t, body: { name: 'Medicaid other' } });
    expect(plan.status).toBe(409);
    // A locked name that no listing uses still stays on the list.
    await call('/api/admin/lists/categories', { method: 'POST', as: t, body: { name: 'Crisis Help' } });
    expect((await call('/api/admin/lists/categories/Crisis%20Help', { method: 'DELETE', as: t })).status).toBe(409);
    const { listing } = await getListing(t, 'sample-food-pantry');
    expect(listing.category).toBe('Food');
    // The list says which names are locked, so the panel can explain.
    const { items } = await (await call('/api/admin/lists/categories', { as: t })).json();
    expect(items.find((i) => i.name === 'Food').locked).toBe(true);
  });

  it('the Domestic Violence category name is locked, so its protections can\'t be renamed away', async () => {
    await call('/api/admin/lists/categories', { method: 'POST', as: t, body: { name: 'Domestic Violence' } });
    const res = await call('/api/admin/lists/categories/Domestic%20Violence', { method: 'PUT', as: t, body: { name: 'Safety Help' } });
    expect(res.status).toBe(409);
  });

  it('asks before adding a second listing with the same name', async () => {
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'sample food pantry' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.warnings.join(' ')).toMatch(/already exists/);
    expect(await countRows('listings')).toBe(5);
  });

  it('two saves of the same new listing at once add it only once', async () => {
    const body = validListing({ name: 'Practice Double Tap Pantry' });
    const results = await Promise.all([1, 2, 3].map(() => call('/api/admin/listings', { method: 'POST', as: t, body })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 409 || s === 422)).toBe(true);
    expect(await countRows('listings')).toBe(6);
  });

  it('one listing with a broken list column doesn\'t take the public directory down', async () => {
    await env.DB.prepare("UPDATE listings SET sources = 'see website' WHERE id = 'sample-food-pantry'").run();
    const res = await call('/api/listings', { sitePublic: true });
    expect(res.status).toBe(200);
    const { listings } = await res.json();
    expect(listings.find((l) => l.id === 'sample-food-pantry').sources).toEqual([]);
  });

  it('renaming a Medicaid plan updates its listings', async () => {
    await call('/api/admin/lists/plans/Fidelis', { method: 'PUT', as: t, body: { name: 'Fidelis Care' } });
    const { listing } = await getListing(t, 'sample-dental-clinic');
    expect(listing.medicaid_plans).toEqual(['Straight Medicaid', 'Fidelis Care']);
  });

  it('won\'t delete a category or plan that is in use', async () => {
    expect((await call('/api/admin/lists/categories/Food', { method: 'DELETE', as: t })).status).toBe(409);
    expect((await call('/api/admin/lists/plans/Fidelis', { method: 'DELETE', as: t })).status).toBe(409);
    expect((await call('/api/admin/lists/plans/United%20Healthcare', { method: 'DELETE', as: t })).status).toBe(200);
  });

  it('exports everything to an Excel file, including private notes', async () => {
    const res = await call('/api/admin/export', { as: t });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/spreadsheetml/);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="resource-directory-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('Sample Food Pantry');
    expect(text).toContain('PRIVATE-MARKER');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stores formula-like text as plain text in the export', async () => {
    await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: '=HYPERLINK("http://evil")' }) });
    const text = new TextDecoder().decode(new Uint8Array(await (await call('/api/admin/export', { as: t })).arrayBuffer()));
    expect(text).toContain('t="inlineStr"');
    expect(text).not.toContain('<f>');
    expect(text).toContain('=HYPERLINK(&quot;http://evil&quot;)');
  });

  it('won\'t add a duplicate category', async () => {
    const res = await call('/api/admin/lists/categories', { method: 'POST', as: t, body: { name: 'food' } });
    expect(res.status).toBe(409);
  });
});
