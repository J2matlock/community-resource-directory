// Public page extras: link previews and listing titles, the sitemap, robots.txt
// and the owner's site notice. Rule 4: a hidden (Internal) or retired listing
// never shows up in a title, preview or sitemap. Rule 3: only the owner can
// change the notice. Rule 5: the notice is written into pages as plain text.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb } from './helpers.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';
import { PUBLIC_FIELDS } from '../src/lib/listing-rules.js';
import { neutralId } from '../src/lib/neutral-id.js';

const page = async (path) => (await call(path, { sitePublic: true })).text();
const setNotice = async (body) => call('/api/admin/notice', { method: 'PUT', body, as: await token() });

describe('Link previews and listing pages', () => {
  beforeEach(resetDb);

  it('a public listing page gets its own title, description and preview tags', async () => {
    const res = await call('/listing/sample-food-pantry', { sitePublic: true });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Sample Food Pantry: ');
    expect(html).toMatch(/<meta property="og:title" content="Sample Food Pantry: [^"]+">/);
    expect(html).toContain('emergency groceries once a month');
    expect(html).toContain('<link rel="canonical" href="https://directory.example.test/listing/sample-food-pantry">');
    expect(html).not.toContain(PRIVATE_MARKER);
    expect(html).not.toContain('noindex');
  });

  it('a listing page carries that listing\'s public details, so its card draws at once', async () => {
    await env.DB.prepare("UPDATE listings SET description = 'Groceries </script><b>x</b>' WHERE id = 'sample-food-pantry'").run();
    const html = await (await call('/listing/sample-food-pantry', { sitePublic: true })).text();
    const m = html.match(/<script type="application\/json" id="listing-data">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain('</script>');
    const data = JSON.parse(m[1]);
    expect(data.id).toBe('sample-food-pantry');
    expect(data.description).toBe('Groceries </script><b>x</b>');
    expect(Object.keys(data).sort()).toEqual([...PUBLIC_FIELDS].sort());
    expect(html).not.toContain(PRIVATE_MARKER);
  });

  it('the home page and unknown listings carry no listing data', async () => {
    expect(await (await call('/', { sitePublic: true })).text()).not.toContain('listing-data');
    expect(await (await call('/listing/no-such-listing', { sitePublic: true })).text()).not.toContain('id="listing-data"');
  });

  it('a database hiccup still leaves the page, with its "Did something not work?" key', async () => {
    const broken = { prepare() { throw new Error('D1 down'); }, batch() { throw new Error('D1 down'); } };
    const res = await call('/listing/sample-food-pantry', { sitePublic: true, envExtra: { DB: broken } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('aside class="crisis"');
    expect(html).toMatch(/id="turnstile-key" data-sitekey="test-site-key"/);
  });

  it('Internal, retired and unknown listings never show a name or details, are not indexed, and answer 404', async () => {
    for (const id of ['sample-internal-contacts', 'sample-retired-shelter', 'no-such-listing']) {
      const res = await call(`/listing/${id}`, { sitePublic: true });
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).not.toContain('Sample Internal Contacts');
      expect(html).not.toContain('Sample Retired Program');
      expect(html).not.toContain(PRIVATE_MARKER);
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).toContain('<title>Listing not found: '); // the directory page still loads and says so
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

  it('a DV listing page never carries its details in the page itself', async () => {
    const html = await page(`/listing/${neutralId('sample-dv-program')}`);
    expect(html).not.toContain('id="listing-data"');
    expect(html).not.toContain('Hotline and advocacy');
  });

  it('the old named address still works but shows only neutral text', async () => {
    const html = await page('/listing/sample-dv-program');
    expect(html).toContain('<title>Local help: ');
    expect(html).not.toContain('Sample Domestic Violence Program');
  });

  it('an unknown neutral address is just "not found"', async () => {
    const res = await call('/listing/h-zzzzzz', { sitePublic: true });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('noindex');
  });
  it('the neutral address list is read once and reused, not on every view', async () => {
    const spy = vi.spyOn(env.DB, 'prepare');
    await page(`/listing/${neutralId('sample-dv-program')}`);
    await page(`/listing/${neutralId('sample-dv-program')}`);
    const idReads = spy.mock.calls.filter(([sql]) => /SELECT id, category FROM listings/.test(sql)).length;
    spy.mockRestore();
    expect(idReads).toBe(1);
  });

  it('a retired DV listing\'s neutral address stops working at once, even while remembered', async () => {
    expect((await call(`/listing/${neutralId('sample-dv-program')}`, { sitePublic: true })).status).toBe(200);
    await env.DB.prepare("UPDATE listings SET retired = 1 WHERE id = 'sample-dv-program'").run();
    const res = await call(`/listing/${neutralId('sample-dv-program')}`, { sitePublic: true });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Sample Domestic Violence Program');
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
    // Saved while current; its last day has since gone by.
    await env.DB.prepare("INSERT INTO site_notice (id, message, level, ends_on, updated_at) VALUES (1, 'Old notice', 'info', '2020-01-01', '2019-12-31T12:00:00Z') ON CONFLICT(id) DO UPDATE SET message = excluded.message, ends_on = excluded.ends_on").run();
    expect(await page('/')).not.toContain('Old notice');
  });

  it('refuses to save a notice whose last day has already passed (it would never show)', async () => {
    const res = await setNotice({ message: 'Code Blue tonight', level: 'info', ends_on: '2020-01-01' });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.ends_on).toMatch(/already passed/);
    // Clearing a notice that still carries an old date is fine.
    expect((await setNotice({ message: '', level: 'info', ends_on: '2020-01-01' })).status).toBe(200);
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

  it('refuses a last day that is not a real date, like the 45th of month 13 or February 30', async () => {
    for (const ends_on of ['2026-13-45', '2026-02-30']) {
      const res = await setNotice({ message: 'ok', level: 'info', ends_on });
      expect(res.status).toBe(422);
      expect((await res.json()).errors.ends_on).toBeTruthy();
    }
  });

  it('two page views in a row read the notice from the database only once (kept for 30 seconds)', async () => {
    const spy = vi.spyOn(env.DB, 'prepare');
    await page('/');
    await page('/learn');
    const noticeReads = spy.mock.calls.filter(([sql]) => /FROM site_notice/.test(sql) && /message/.test(sql)).length;
    spy.mockRestore();
    expect(noticeReads).toBe(1);
  });

  it('the admin panel always reads the notice fresh', async () => {
    await page('/'); // fills the 30-second memo with "no notice"
    await env.DB.prepare("UPDATE site_notice SET message = 'Changed behind the scenes' WHERE id = 1").run();
    const res = await call('/api/admin/notice', { as: await token() });
    expect((await res.json()).notice.message).toBe('Changed behind the scenes');
  });
});
