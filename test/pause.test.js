// Emergency pause (owner decision, 2026-10-12): every public address shows
// only the crisis numbers and 211, forms take nothing, the admin panel keeps
// working, and only the owner can switch it.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows, validRequest } from './helpers.js';

async function pause(on) {
  return call('/api/admin/pause', { method: 'PUT', as: await token(), body: { paused: on } });
}

describe('Emergency pause', () => {
  beforeEach(resetDb);

  it('shows only the crisis numbers and 211 on public pages, and stops the forms', async () => {
    expect((await pause(true)).status).toBe(200);
    for (const path of ['/', '/learn', '/listing/sample-food-pantry', '/request']) {
      const res = await call(path, { sitePublic: true });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('is paused for now');
      expect(text).toContain('tel:988');
      expect(text).toContain('211');
      expect(text).not.toContain('id="results"');
      expect(res.headers.get('Cache-Control')).toContain('no-store');
    }
    const data = await call('/api/listings', { sitePublic: true });
    expect(data.status).toBe(503);
    expect(await data.text()).not.toContain('sample-food-pantry');
    const form = await call('/api/requests', { method: 'POST', sitePublic: true, body: validRequest() });
    expect(form.status).toBe(503);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('keeps the admin panel working while paused, and turns back on', async () => {
    await pause(true);
    const t = await token();
    expect((await call('/api/admin/listings', { as: t })).status).toBe(200);
    expect((await (await call('/api/admin/pause', { as: t })).json()).paused).toBe(true);
    await pause(false);
    expect(await (await call('/', { sitePublic: true })).text()).not.toContain('is paused for now');
  });

  it('the pause page\'s style and cleanup script still load while paused', async () => {
    await pause(true);
    const js = await call('/js/paused.js', { sitePublic: true });
    expect(await js.text()).toContain('serviceWorker');
    const css = await call('/css/site.css', { sitePublic: true });
    expect(await css.text()).toContain('.paused-page');
  });

  it('the SITE_PAUSED setting is a backup switch', async () => {
    const res = await call('/', { sitePublic: true, envExtra: { SITE_PAUSED: 'true' } });
    expect(await res.text()).toContain('is paused for now');
  });

  it('only the owner can switch it, and the value must be true or false', async () => {
    expect((await call('/api/admin/pause', { method: 'PUT', body: { paused: true } })).status).not.toBe(200);
    expect((await call('/', { sitePublic: true })).status).toBe(200);
    expect(await (await call('/', { sitePublic: true })).text()).not.toContain('is paused for now');
    expect((await call('/api/admin/pause', { method: 'PUT', as: await token(), body: { paused: 'yes' } })).status).toBe(422);
  });
});
