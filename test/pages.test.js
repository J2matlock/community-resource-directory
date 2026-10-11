// Public page extras: link previews and listing titles, the sitemap, robots.txt
// and the owner's site notice. Rule 4: a hidden (Internal) or retired listing
// never shows up in a title, preview or sitemap. Rule 3: only the owner can
// change the notice. Rule 5: the notice is written into pages as plain text.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb } from './helpers.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';
import { neutralId } from '../src/lib/neutral-id.js';

const page = async (path) => (await call(path, { sitePublic: true })).text();
const setNotice = async (body) => call('/api/admin/notice', { method: 'PUT', body, as: await token() });

describe('Link previews and listing pages', () => {
  beforeEach(resetDb);

  it('a public listing page gets its own title, description and preview tags', async () => {
    const html = await page('/listing/sample-food-pantry');
    expect(html).toContain('<title>Sample Food Pantry: ');
    expect(html).toMatch(/<meta property="og:title" content="Sample Food Pantry: [^"]+">/);
    expect(html).toContain('emergency groceries once a month');
    expect(html).toContain('<link rel="canonical" href="https://directory.example.test/listing/sample-food-pantry">');
    expect(html).not.toContain(PRIVATE_MARKER);
    expect(html).not.toContain('noindex');
  });

  it('Internal and retired listings never show their name or details, and are not indexed', async () => {
    for (const id of ['sample-internal-contacts', 'sample-retired-shelter']) {
      const html = await page(`/listing/${id}`);
      expect(html).not.toContain('Sample Internal Contacts');
      expect(html).not.toContain('Sample Retired Program');
      expect(html).not.toContain(PRIVATE_MARKER);
      expect(html).toContain('<meta name="robots" content="noindex">');
    }
  });

  it('other pages keep their own title and get preview tags', async () => {
    const html = await page('/learn');
    expect(html).toMatch(/<meta property="og:title" content="[^"]*Learn[^"]*">/);
    expect(html).toContain('og:image');
  });

  it('the sitemap lists public pages and listings only', async () => {
    const res = await call('/sitemap.xml', { sitePublic: true });
    expect(res.headers.get('Content-Type')).toContain('xml');
    const xml = await res.text();
    expect(xml).toContain('/listing/sample-food-pantry</loc>');
    expect(xml).not.toContain('sample-internal-contacts');
    expect(xml).not.toContain('sample-retired-shelter');
  });

  it('robots.txt keeps admin and data addresses out and points to the sitemap', async () => {
    const txt = await (await call('/robots.txt', { sitePublic: true })).text();
    expect(txt).toContain('Disallow: /admin/');
    expect(txt).toContain('Disallow: /api/');
    expect(txt).toContain('Sitemap: https://directory.example.test/sitemap.xml');
  });
});

describe('Domestic violence listings stay discreet', () => {
  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('Domestic Violence')").run();
    await env.DB.prepare(`INSERT INTO listings (id, name, organization, category, tags, phone, fax, email, website, address, town,
      serves_counties, hours, eligibility, age_groups, cost, medicaid_plans, medicaid_notes, description, private_notes, status, review_by,
      visibility, last_verified, retired) VALUES ('sample-dv-program', 'Sample Domestic Violence Program', '', 'Domestic Violence', '[]',
      '(518) 555-0150', '', '', '', '', '', '["Warren"]', '24 hours', '', '[]', '["Free"]', '[]', '', 'Hotline and advocacy.', '', 'Active', '',
      'Public', '', 0)`).run();
  });

  it('uses a neutral address in the sitemap, never the named one', async () => {
    const xml = await (await call('/sitemap.xml', { sitePublic: true })).text();
    expect(xml).toContain(`/listing/${neutralId('sample-dv-program')}</loc>`);
    expect(xml).not.toContain('sample-dv-program');
  });

  it('the neutral address opens the listing with a neutral title and preview', async () => {
    const html = await page(`/listing/${neutralId('sample-dv-program')}`);
    expect(html).toContain('<title>Local help: ');
    expect(html).not.toContain('Sample Domestic Violence Program');
    expect(html).toContain(`<link rel="canonical" href="https://directory.example.test/listing/${neutralId('sample-dv-program')}">`);
    expect(html).not.toContain('noindex');
  });

  it('the old named address still works but shows only neutral text', async () => {
    const html = await page('/listing/sample-dv-program');
    expect(html).toContain('<title>Local help: ');
    expect(html).not.toContain('Sample Domestic Violence Program');
  });

  it('an unknown neutral address is just "not found"', async () => {
    expect(await page('/listing/h-zzzzzz')).toContain('noindex');
  });
});

describe('Site notice', () => {
  beforeEach(resetDb);

  it('no notice shows by default', async () => {
    expect(await page('/')).not.toContain('site-notice');
  });

  it('the owner can set a notice; it shows on public pages as plain text', async () => {
    const res = await setNotice({ message: 'Code Blue <script>alert(1)</script> tonight & tomorrow', level: 'urgent', ends_on: '' });
    expect(res.status).toBe(200);
    for (const path of ['/', '/learn', '/listing/sample-food-pantry']) {
      const html = await page(path);
      expect(html).toContain('class="site-notice urgent"');
      expect(html).toContain('Code Blue &lt;script&gt;alert(1)&lt;/script&gt; tonight &amp; tomorrow');
      expect(html).not.toContain('<script>alert(1)</script>');
    }
  });

  it('a returning visitor always gets the current notice (no stale "not changed" page)', async () => {
    const first = await call('/', { sitePublic: true });
    const etag = first.headers.get('ETag');
    expect(etag).toBeNull();
    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    await setNotice({ message: 'New notice after the first visit', level: 'info', ends_on: '' });
    const again = await call('/', { sitePublic: true, headers: { 'If-None-Match': '*', 'If-Modified-Since': new Date().toUTCString() } });
    expect(again.status).toBe(200);
    expect(await again.text()).toContain('New notice after the first visit');
  });

  it('a notice whose last day has passed hides itself', async () => {
    await setNotice({ message: 'Old notice', level: 'info', ends_on: '2020-01-01' });
    expect(await page('/')).not.toContain('Old notice');
  });

  it('refuses over-long text, client details, bad dates and unknown styles', async () => {
    for (const body of [
      { message: 'x'.repeat(281) }, { message: 'DOB 01/02/1960 call her' }, { message: 'ok', ends_on: 'next week' },
      { message: 'ok', level: 'blink' }, { message: 'two\nlines' },
    ]) {
      const res = await setNotice({ level: 'info', ends_on: '', ...body });
      expect(res.status).toBe(422);
    }
    const row = await env.DB.prepare('SELECT message FROM site_notice WHERE id = 1').first();
    expect(row.message).toBe('');
  });
});
