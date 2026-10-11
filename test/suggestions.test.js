// "Don't see the help you need?" messages. Rule 1: nothing that could identify
// a person is accepted; rule 5: input is untrusted (plain-text email, checked
// and size-limited); only the owner can read them.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows, fakeEmail } from './helpers.js';

let ipCounter = 0;
function suggest(body, opts = {}) {
  const email = opts.email ?? fakeEmail();
  const b = { looking_for: 'Help paying for hearing aids', county: '', nickname: '', turnstile_token: 'pass-token:suggest', ...body };
  return call('/api/suggestions', {
    method: 'POST', body: b, sitePublic: true,
    headers: { 'CF-Connecting-IP': opts.ip ?? `198.51.100.${++ipCounter}` },
    envExtra: { SEND_EMAIL: email.binding },
  }).then((res) => ({ res, email }));
}

describe('Help suggestions', () => {
  beforeEach(resetDb);

  it('saves an anonymous message and emails the owner plain text, with web addresses broken up', async () => {
    const { res, email } = await suggest({ looking_for: 'Hearing aids <b>help</b> https://evil.example', county: 'Saratoga' });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT * FROM help_suggestions').first();
    expect(Object.keys(row).sort()).toEqual(['county', 'created_at', 'email_sent', 'id', 'looking_for']);
    expect(row).toMatchObject({ county: 'Saratoga', email_sent: 1 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].html).toBeUndefined();
    expect(email.sent[0].text).toContain('Hearing aids');
    expect(email.sent[0].text).not.toContain('https://evil.example');
    const { email: email2 } = await suggest({ looking_for: 'https://evil.example has free food' });
    expect(email2.sent[0].subject).not.toContain('https://evil.example');
  });

  it('refuses names, ages, birth dates, phone numbers, emails and ID numbers', async () => {
    for (const looking_for of ['call me at 518-555-1234', 'email me jo@example.org', 'DOB 01/02/1960', 'my SSN is 123-45-6789',
      'my client John Smith needs a ride', 'he is 67 years old', 'Mrs. Jones needs a ride']) {
      const { res } = await suggest({ looking_for });
      expect(res.status).toBe(422);
    }
    expect(await countRows('help_suggestions')).toBe(0);
  });

  it('refuses empty, over-long and wrongly typed answers, and unknown counties', async () => {
    for (const body of [{ looking_for: '' }, { looking_for: 'x'.repeat(501) }, { looking_for: ['a', 'b'] }, { county: 'Albany' }, { county: '<script>' }]) {
      const { res } = await suggest(body);
      expect(res.status).toBe(422);
    }
    expect(await countRows('help_suggestions')).toBe(0);
  });

  it('quietly drops robots that fill in the trap field, and refuses a failed human check', async () => {
    expect((await suggest({ nickname: 'bot' })).res.status).toBe(200);
    expect((await suggest({ turnstile_token: 'fail-token' })).res.status).toBe(403);
    // A pass earned on another form (here the provider form) doesn't count.
    expect((await suggest({ turnstile_token: 'pass-token:request' })).res.status).toBe(403);
    expect(await countRows('help_suggestions')).toBe(0);
  });

  it('limits each sender to 3 messages an hour', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await suggest({}, { ip: '203.0.113.77' })).res.status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('only the owner can read the messages', async () => {
    await suggest({});
    expect((await call('/api/admin/suggestions', { sitePublic: true })).status).not.toBe(200);
    const res = await call('/api/admin/suggestions', { as: await token() });
    expect(res.status).toBe(200);
    expect((await res.json()).suggestions).toHaveLength(1);
  });
});
