// Rule 3: only the owner can edit. The Worker itself checks the Access token
// (signature, issuer, audience) and the email on every admin request.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows, validListing, OWNER } from './helpers.js';

const ADMIN_REQUESTS = [
  ['GET', '/api/admin/whoami'],
  ['GET', '/api/admin/listings'],
  ['POST', '/api/admin/listings', validListing()],
  ['GET', '/api/admin/listings/sample-food-pantry'],
  ['PUT', '/api/admin/listings/sample-food-pantry', validListing({ name: 'Changed' })],
  ['POST', '/api/admin/listings/sample-food-pantry/verify'],
  ['POST', '/api/admin/listings/sample-food-pantry/retire'],
  ['POST', '/api/admin/listings/sample-retired-shelter/restore'],
  ['GET', '/api/admin/recheck'],
  ['GET', '/api/admin/lists/categories'],
  ['POST', '/api/admin/lists/categories', { name: 'New Category' }],
  ['PUT', '/api/admin/lists/categories/Food', { name: 'Groceries' }],
  ['DELETE', '/api/admin/lists/plans/Fidelis'],
  ['GET', '/api/admin/export'],
  ['GET', '/api/admin/requests'],
  ['GET', '/api/admin/barriers'],
  ['GET', '/api/admin/suggestions'],
  ['GET', '/api/admin/region'],
  ['POST', '/api/admin/requests/1/handled', { note: 'x' }],
  ['GET', '/admin/'],
];

async function snapshot() {
  const listings = await env.DB.prepare('SELECT * FROM listings ORDER BY id').all();
  return JSON.stringify(listings.results) + (await countRows('listing_history')) + (await countRows('categories')) + (await countRows('medicaid_plans'));
}

describe('Rule 3: only the owner can edit', () => {
  beforeEach(resetDb);

  const badTokens = {
    'no login at all': async () => null,
    'a different email': async () => token('someone-else@example.test'),
    'the owner email with different capitals but a wrong key': async () => token(OWNER.toUpperCase(), { wrongKey: true }),
    'a token signed by the wrong key': async () => token(OWNER, { wrongKey: true }),
    'a token for a different Access app (audience)': async () => token(OWNER, { audience: 'some-other-app' }),
    'a token from a different team (issuer)': async () => token(OWNER, { issuer: 'https://evil.cloudflareaccess.com' }),
    'an expired token': async () => token(OWNER, { expires: '-1m' }),
    'an unsigned token': async () => {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      return `${b64({ alg: 'none' })}.${b64({ email: OWNER, iss: env.TEAM_DOMAIN, aud: env.POLICY_AUD })}.`;
    },
    'garbage': async () => 'not-a-token',
  };

  for (const [label, make] of Object.entries(badTokens)) {
    it(`refuses every admin request with ${label}, and changes nothing`, async () => {
      const before = await snapshot();
      const t = await make();
      for (const [method, path, body] of ADMIN_REQUESTS) {
        for (const sitePublic of [false, true]) {
          const res = await call(path, { method, body, as: t, sitePublic });
          expect(res.status, `${method} ${path} (site public: ${sitePublic})`).toBe(403);
          const text = await res.text();
          expect(text).not.toContain('PRIVATE-MARKER');
        }
      }
      expect(await snapshot()).toBe(before);
    });
  }

  it('lets the owner in', async () => {
    const res = await call('/api/admin/whoami', { as: await token() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: OWNER });
  });

  it('accepts the owner email in any capitals', async () => {
    const res = await call('/api/admin/whoami', { as: await token('Owner@Example.TEST') });
    expect(res.status).toBe(200);
  });

  it('refuses all admin requests if the admin email setting is missing', async () => {
    const { default: worker } = await import('../src/index.js');
    const req = new Request('https://directory.example.test/api/admin/whoami', { headers: { 'Cf-Access-Jwt-Assertion': await token() } });
    const res = await worker.fetch(req, { ...env, ADMIN_EMAIL: '' });
    expect(res.status).toBe(403);
  });

  it('refuses all admin requests if the Access app settings are missing', async () => {
    const { default: worker } = await import('../src/index.js');
    for (const missing of [{ POLICY_AUD: '' }, { TEAM_DOMAIN: '' }]) {
      const req = new Request('https://directory.example.test/api/admin/whoami', { headers: { 'Cf-Access-Jwt-Assertion': await token() } });
      const res = await worker.fetch(req, { ...env, ...missing });
      expect(res.status).toBe(403);
    }
  });

  it('local test mode only works on localhost, never on a real address', async () => {
    const { default: worker } = await import('../src/index.js');
    const localEnv = { ...env, LOCAL_DEV_ADMIN: 'true' };
    const live = await worker.fetch(new Request('https://directory.example.test/api/admin/whoami'), localEnv);
    expect(live.status).toBe(403);
    const fakeHost = await worker.fetch(new Request('https://directory.example.test/api/admin/whoami', { headers: { Host: 'localhost' } }), localEnv);
    expect(fakeHost.status).toBe(403);
    const local = await worker.fetch(new Request('http://localhost:8787/api/admin/whoami'), localEnv);
    expect(local.status).toBe(200);
    const off = await worker.fetch(new Request('http://localhost:8787/api/admin/whoami'), env);
    expect(off.status).toBe(403);
  });

  it('refuses owner writes sent from another website', async () => {
    const before = await snapshot();
    const t = await token();
    for (const origin of ['https://evil.example', null]) {
      const res = await call('/api/admin/listings', { method: 'POST', body: validListing(), as: t, origin });
      expect(res.status).toBe(403);
    }
    expect(await snapshot()).toBe(before);
  });

  it('keeps the whole site owner-only before launch', async () => {
    for (const path of ['/', '/api/listings', '/listing/sample-food-pantry']) {
      const res = await call(path);
      expect(res.status, path).toBe(403);
    }
    const ok = await call('/api/listings', { as: await token() });
    expect(ok.status).toBe(200);
  });

  it('marks admin responses as not cacheable', async () => {
    const res = await call('/api/admin/listings', { as: await token() });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
