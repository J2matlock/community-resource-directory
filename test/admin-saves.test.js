// Admin saves: checks before saving, change history, Verified today,
// Retire/Restore, Due for re-check, and managed lists.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, validListing, OWNER } from './helpers.js';
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
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Sample Food Pantry' }) });
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

  it('"Due for re-check" lists unverified, old, and past-review listings', async () => {
    const due = (await dueForRecheck(env.DB, '2026-12-01')).map((l) => l.id);
    // Never verified (dental, internal), verified over 11 months ago (legal),
    // review date passed (dental). Retired listings are left out.
    expect(due).toContain('sample-dental-clinic');
    expect(due).toContain('sample-legal-help');
    expect(due).toContain('sample-internal-contacts');
    expect(due).not.toContain('sample-food-pantry');
    expect(due).not.toContain('sample-retired-shelter');
    expect(due[0]).toBe('sample-dental-clinic');
  });

  it('renaming a category updates its listings, with history', async () => {
    const res = await call('/api/admin/lists/categories/Food', { method: 'PUT', as: t, body: { name: 'Food and Meals' } });
    expect(res.status).toBe(200);
    const { listing, history } = await getListing(t, 'sample-food-pantry');
    expect(listing.category).toBe('Food and Meals');
    expect(history[0]).toMatchObject({ field: 'category', old_value: 'Food', new_value: 'Food and Meals' });
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
