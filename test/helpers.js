// Test helpers: fake Cloudflare Access tokens, a fake key server, and a
// database reset with the made-up sample listings.

import { env } from 'cloudflare:test';
import { vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import worker from '../src/index.js';
import { SAMPLE_CATEGORIES, SAMPLE_PLANS, SAMPLE_LISTINGS } from './fixtures/sample-listings.js';

export const OWNER = 'owner@example.test';
export const ORIGIN = 'https://directory.example.test';

const ownKeys = await generateKeyPair('RS256', { extractable: true });
const otherKeys = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(ownKeys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

// Answer the Worker's request for Cloudflare Access signing keys.
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === `${env.TEAM_DOMAIN}/cdn-cgi/access/certs`) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
  }
  // Fake Turnstile: only "pass-token[:action]" with the right secret passes.
  // The action names the form the check was done on ("request" if not given).
  if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
    const response = init.body.get('response');
    const [base, action = 'request'] = String(response).split(':');
    const ok = init.body.get('secret') === env.TURNSTILE_SECRET_KEY && (base === 'pass-token' || base === 'other-site-token');
    const hostname = base === 'other-site-token' ? 'evil.example' : 'directory.example.test';
    return new Response(JSON.stringify({ success: ok, hostname, action }), { headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
});

/** A signed Access token. Options let tests break one thing at a time. */
export async function token(email = OWNER, opts = {}) {
  const jwt = new SignJWT({ email, type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.issuer ?? env.TEAM_DOMAIN)
    .setAudience(opts.audience ?? env.POLICY_AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expires ?? '1h');
  return jwt.sign(opts.wrongKey ? otherKeys.privateKey : ownKeys.privateKey);
}

/** Calls the Worker. `as` = token string or null; `public` = launched site. */
export async function call(path, { method = 'GET', body, as = null, origin = ORIGIN, sitePublic = false, headers = {}, envExtra = {} } = {}) {
  const h = new Headers(headers);
  if (as) h.set('Cf-Access-Jwt-Assertion', as);
  if (origin && method !== 'GET' && method !== 'HEAD') h.set('Origin', origin);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const req = new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return worker.fetch(req, { ...env, SITE_PUBLIC: sitePublic ? 'true' : 'false', ...envExtra });
}

export async function resetDb() {
  const db = env.DB;
  await db.batch([
    db.prepare('DELETE FROM listing_history'),
    db.prepare('DELETE FROM provider_requests'),
    db.prepare('DELETE FROM request_rate'),
    db.prepare('DELETE FROM barrier_reports'),
    db.prepare('DELETE FROM barrier_rate'),
    db.prepare('DELETE FROM help_suggestions'),
    db.prepare('DELETE FROM suggestion_rate'),
    db.prepare('DELETE FROM listings'),
    db.prepare('DELETE FROM categories'),
    db.prepare('DELETE FROM medicaid_plans'),
  ]);
  const stmts = [
    ...SAMPLE_CATEGORIES.map((c) => db.prepare('INSERT INTO categories (name) VALUES (?)').bind(c)),
    ...SAMPLE_PLANS.map((p) => db.prepare('INSERT INTO medicaid_plans (name) VALUES (?)').bind(p)),
  ];
  for (const l of SAMPLE_LISTINGS) {
    const row = { ...l };
    for (const k of ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans']) row[k] = JSON.stringify(row[k]);
    const cols = Object.keys(row);
    stmts.push(db.prepare(`INSERT INTO listings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])));
  }
  await db.batch(stmts);
}

export async function countRows(table) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
}

/** A complete, valid listing body for create/update calls. */
export function validListing(overrides = {}) {
  return {
    name: 'New Practice Listing', organization: '', category: 'Food', tags: ['food'], phone: '518-555-0110',
    fax: '', email: '', website: 'example.org', address: '', town: '', serves_counties: ['Warren'], hours: '',
    eligibility: '', age_groups: [], cost: ['Free'], medicaid_plans: [], medicaid_notes: '',
    description: 'Practice listing.', private_notes: '', status: 'Active', review_by: '', visibility: 'Public', last_verified: '',
    ...overrides,
  };
}

/** A complete, valid provider request. */
export function validRequest(overrides = {}) {
  return {
    organization: 'Practice Pantry Program', services: 'Free groceries once a month.', eligibility: 'Warren County residents',
    age_groups: ['Adults'], cost: ['Free'], medicaid: '', counties: ['Warren'], address: '5 Example Street, Glens Falls, NY',
    no_public_address: false, hours: 'Fridays 10–12', phone: '518-555-0130', email: 'info@example.org', website: 'example.org',
    how_to_start: 'Walk in.', submitter_name: 'Sam Provider', submitter_contact: 'sam@example.org', ok_to_publish: true,
    nickname: '', turnstile_token: 'pass-token',
    ...overrides,
  };
}

/** A fake email sender that records what it was asked to send. */
export function fakeEmail({ fail = false } = {}) {
  const sent = [];
  return { sent, binding: { send: async (msg) => { if (fail) throw new Error('send failed'); sent.push(msg); return { messageId: 'x' }; } } };
}
