// Rule 5: provider form input is untrusted. The server checks type and
// length, stops spam, saves a copy first, and only ever emails plain text.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows, validRequest, fakeEmail, validListing } from './helpers.js';

function send(body, opts = {}) {
  const email = opts.email ?? fakeEmail();
  return call('/api/requests', {
    method: 'POST', body, sitePublic: true,
    headers: { 'CF-Connecting-IP': opts.ip ?? '203.0.113.7' },
    envExtra: { SEND_EMAIL: email.binding },
    origin: opts.origin,
  }).then((res) => ({ res, email }));
}

describe('Rule 5: provider form input is untrusted', () => {
  beforeEach(resetDb);

  it('saves a good request and emails the owner plain text', async () => {
    const { res, email } = await send(validRequest());
    expect(res.status).toBe(201);
    expect(await countRows('provider_requests')).toBe(1);
    const row = await env.DB.prepare('SELECT * FROM provider_requests').first();
    expect(JSON.parse(row.fields)).toEqual({ request_type: 'correction', organization: 'Practice Pantry Program', correction: 'New hours: Fridays 10 AM to noon.' });
    expect(row.email_sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0];
    expect(msg.to).toBe(env.FORWARD_TO);
    expect(msg.html).toBeUndefined();
    expect(msg.from).toBe('requests@example.test');
    expect(msg.subject).toBe('Correction request #' + row.id + ': Practice Pantry Program');
    expect(msg.text).toContain('New hours: Fridays 10 AM to noon.');
  });

  it('never stores a name, contact details or any field besides the correction', async () => {
    const { res, email } = await send(validRequest({ correction: 'See https://example.org/new-hours', submitter_name: 'Sam Provider', submitter_contact: 'sam@example.org', services: 'Groceries', phone: '518-555-0130' }));
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT fields FROM provider_requests').first();
    expect(Object.keys(JSON.parse(row.fields)).sort()).toEqual(['correction', 'organization', 'request_type']);
    expect(row.fields).not.toContain('Sam Provider');
    expect(row.fields).not.toContain('sam@example.org');
    expect(email.sent[0].text).not.toContain('Sam Provider');
    expect(email.sent[0].text).toContain('https[:]//example[.]org');
  });

  it('keeps the request even if the email fails', async () => {
    const { res } = await send(validRequest(), { email: fakeEmail({ fail: true }) });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT email_sent FROM provider_requests').first();
    expect(row.email_sent).toBe(0);
  });

  it('refuses missing required answers and saves nothing', async () => {
    const { res, email } = await send(validRequest({ organization: '', correction: '  ' }));
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(['correction', 'organization']);
    expect(await countRows('provider_requests')).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('refuses wrong types, unknown choices and over-long answers', async () => {
    for (const bad of [
      { organization: { evil: true } },
      { correction: ['a list'] },
      { correction: 'x'.repeat(3001) },
      { organization: 'x'.repeat(201) },
      { request_type: 'new' },
    ].entries()) {
      // A different sender each time: rejected attempts count toward the hourly limit too.
      const { res } = await send(validRequest(bad[1]), { ip: `192.0.2.${bad[0] + 1}` });
      expect(res.status, JSON.stringify(bad[1]).slice(0, 60)).toBe(422);
    }
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('refuses a huge request', async () => {
    const { res } = await send(validRequest({ correction: 'x'.repeat(30_000) }));
    expect(res.status).toBe(413);
  });

  it('quietly drops robots that fill in the hidden trap field', async () => {
    const { res, email } = await send(validRequest({ nickname: 'spam bot' }));
    expect(res.status).toBe(200);
    expect(await countRows('provider_requests')).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('refuses requests that fail the Turnstile check', async () => {
    for (const t of ['', 'wrong-token', undefined]) {
      const { res } = await send(validRequest({ turnstile_token: t }));
      expect(res.status).toBe(403);
    }
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('refuses a Turnstile pass that was made for a different website', async () => {
    const { res } = await send(validRequest({ turnstile_token: 'other-site-token' }));
    expect(res.status).toBe(403);
  });

  it('refuses to run without the IP salt, so stored hashes stay unreadable', async () => {
    const res = await call('/api/requests', {
      method: 'POST', body: validRequest(), sitePublic: true, headers: { 'CF-Connecting-IP': '203.0.113.7' }, envExtra: { IP_SALT: '' },
    });
    expect(res.status).toBe(503);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('limits each sender to 5 requests an hour', async () => {
    for (let i = 0; i < 5; i++) expect((await send(validRequest())).res.status).toBe(201);
    expect((await send(validRequest())).res.status).toBe(429);
    expect((await send(validRequest(), { ip: '198.51.100.9' })).res.status).toBe(201);
    const rows = await env.DB.prepare('SELECT ip_hash FROM request_rate').all();
    expect(JSON.stringify(rows.results)).not.toContain('203.0.113.7');
  });

  it('refuses requests sent from another website', async () => {
    const { res } = await send(validRequest(), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('accepts a correction with just the listing and what to fix, and labels it', async () => {
    const { res, email } = await send({
      request_type: 'correction', organization: 'Practice Pantry Program', correction: 'New phone is 518-555-0199.',
      nickname: '', turnstile_token: 'pass-token',
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT fields FROM provider_requests').first();
    expect(JSON.parse(row.fields)).toMatchObject({ request_type: 'correction', correction: 'New phone is 518-555-0199.' });
    expect(email.sent[0].subject).toMatch(/^Correction request #\d+: Practice Pantry Program$/);
    expect(email.sent[0].text).toContain('What needs to be corrected');
  });

  it('a correction must say what to correct, and new-listing requests are refused', async () => {
    const base = { organization: 'X', nickname: '', turnstile_token: 'pass-token' };
    const a = await send({ ...base, request_type: 'correction', correction: '' }, { ip: '203.0.113.21' });
    expect(a.res.status).toBe(422);
    expect((await a.res.json()).errors.correction).toBeTruthy();
    const b = await send({ ...validRequest(), request_type: 'delete everything' }, { ip: '203.0.113.22' });
    expect(b.res.status).toBe(422);
    const c = await send({ ...validRequest(), request_type: 'new' }, { ip: '203.0.113.23' });
    expect(c.res.status).toBe(422);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('a correction never accepts a shelter location', async () => {
    const { res } = await send({ request_type: 'correction', organization: 'Wellspring', correction: 'The shelter is located at 12 Elm Street now.',
      nickname: '', turnstile_token: 'pass-token' }, { ip: '203.0.113.31' });
    expect(res.status).toBe(422);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('keeps line breaks out of the email subject', async () => {
    const { email } = await send(validRequest({ organization: 'Pantry\r\nBcc: someone@evil.example' }));
    expect(email.sent[0].subject).not.toMatch(/[\r\n]/);
  });

  it('stores typed HTML as plain text and the admin inbox returns it as data', async () => {
    await send(validRequest({ organization: '<img src=x onerror=alert(1)>', correction: '<script>alert(1)</script>' }));
    const res = await call('/api/admin/requests', { as: await token() });
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const { requests } = await res.json();
    expect(requests[0].fields.correction).toBe('<script>alert(1)</script>');
  });

  it('refuses client information', async () => {
    const { res } = await send(validRequest({ correction: 'Our client DOB: 1/2/1960 needs help' }));
    expect(res.status).toBe(422);
  });

  it('is owner-only before launch', async () => {
    const res = await call('/api/requests', { method: 'POST', body: validRequest(), sitePublic: false });
    expect(res.status).toBe(403);
    expect(await countRows('provider_requests')).toBe(0);
  });

  it('the form page gets the Turnstile site key from the settings', async () => {
    const res = await call('/request', { sitePublic: true });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-sitekey="test-site-key"');
  });

  it('"Create listing from this" marks the request handled in the same step', async () => {
    await send(validRequest());
    const t = await token();
    const { requests } = await (await call('/api/admin/requests', { as: t })).json();
    const id = requests[0].id;
    const res = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Practice Pantry Program', visibility: 'Internal', from_request_id: id }) });
    expect(res.status).toBe(201);
    const after = (await (await call('/api/admin/requests', { as: t })).json()).requests[0];
    expect(after).toMatchObject({ status: 'Handled', listing_id: 'practice-pantry-program' });
    // A second try can't make a duplicate.
    // (Even past the "same name" warning.)
    const again = await call('/api/admin/listings', { method: 'POST', as: t, body: validListing({ name: 'Practice Pantry Program', from_request_id: id, confirm_warnings: true }) });
    expect(again.status).toBe(409);
    expect(await countRows('listings')).toBe(6); // 5 samples + 1, no duplicate
  });

  it('"Mark handled" records a short note', async () => {
    await send(validRequest());
    const t = await token();
    const id = (await (await call('/api/admin/requests', { as: t })).json()).requests[0].id;
    expect((await call(`/api/admin/requests/${id}/handled`, { method: 'POST', as: t, body: { note: 'Declined: outside our area' } })).status).toBe(200);
    expect((await call(`/api/admin/requests/${id}/handled`, { method: 'POST', as: t, body: { note: 'again' } })).status).toBe(409);
    const row = await env.DB.prepare('SELECT status, handled_note FROM provider_requests').first();
    expect(row).toEqual({ status: 'Handled', handled_note: 'Declined: outside our area' });
  });
});
