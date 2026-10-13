// Friendly error pages: a wrong address, a locked page or a server error on a
// phone shows a small page with the crisis bar and a way back, never a bare
// line of text. Data addresses (/api/...) keep answering JSON. Rule 4: no
// private data on any of them. Also checks the security headers every reply gets.

import { describe, it, expect, beforeEach } from 'vitest';
import { call, resetDb } from './helpers.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';
import { REGION } from '../src/region.js';
import { crisisBarHtml } from '../src/lib/crisis-bar.js';

const hotlines = REGION.crisis.flatMap((g) => g.items.filter((i) => i.href).map((i) => i.number));

function looksLikeErrorPage(html, heading) {
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('<meta name="viewport"');
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect(html).toContain('<link rel="stylesheet" href="/css/site.css">');
  expect(html).toContain(`<h1>${heading}</h1>`);
  expect(html).toContain('href="/"');
  expect(html).toContain(REGION.fallback.webLabel);
  for (const n of hotlines) expect(html).toContain(n);
  // The exact crisis bar every public page carries (scripts/privacy-check.mjs
  // proves public/index.html holds this same markup), then the site name in
  // the usual header band, then the message.
  expect(html).toContain(crisisBarHtml(REGION));
  expect(html).toContain(`<p class="site-name"><a href="/">${REGION.siteName}</a></p>`);
  const bar = html.indexOf('<aside class="crisis"');
  const header = html.indexOf('<header class="site-header">');
  const main = html.indexOf('<main');
  expect(bar).toBeGreaterThan(-1);
  expect(header).toBeGreaterThan(bar);
  expect(main).toBeGreaterThan(header);
  expect(html).not.toContain(PRIVATE_MARKER);
}

describe('Friendly error pages', () => {
  beforeEach(resetDb);

  it('a made-up page address answers 404 with a small page, not plain text', async () => {
    const res = await call('/this-page-does-not-exist', { sitePublic: true });
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    looksLikeErrorPage(await res.text(), 'Page not found');
  });

  it('a made-up data address still answers JSON', async () => {
    const res = await call('/api/nope', { sitePublic: true });
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Not found.' });
  });

  it('the admin panel, logged out, answers 403 with a "Not available" page', async () => {
    const res = await call('/admin/', { sitePublic: true });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    looksLikeErrorPage(await res.text(), 'Not available');
    // Admin data addresses still answer JSON.
    const api = await call('/api/admin/listings', { sitePublic: true });
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: 'Not available.' });
  });

  it('before launch, every page is "Not available" (not a bare line of text)', async () => {
    const res = await call('/', { sitePublic: false });
    expect(res.status).toBe(403);
    looksLikeErrorPage(await res.text(), 'Not available');
  });

  it('a server error on a page shows "Something went wrong"; on a data address, JSON', async () => {
    // Without a database the sitemap can't be built.
    const res = await call('/sitemap.xml', { sitePublic: true, envExtra: { DB: undefined } });
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    looksLikeErrorPage(await res.text(), 'Something went wrong');
    const api = await call('/api/listings', { sitePublic: true, envExtra: { DB: undefined } });
    expect(api.status).toBe(500);
    expect(await api.json()).toEqual({ error: 'Something went wrong.' });
  });

  it('every reply carries the security headers, error pages included', async () => {
    for (const path of ['/this-page-does-not-exist', '/api/nope', '/', '/api/listings']) {
      const res = await call(path, { sitePublic: true });
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    }
  });
});
