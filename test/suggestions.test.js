// The "Don't see the help you need?" form was removed (owner decision,
// 2026-10-12). Its address takes nothing, the old page link goes to the
// directory, and earlier messages stay readable by the owner only.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows } from './helpers.js';

describe('Help suggestions (form removed)', () => {
  beforeEach(resetDb);

  it('refuses new messages and stores nothing', async () => {
    const res = await call('/api/suggestions', {
      method: 'POST', sitePublic: true,
      body: { looking_for: 'Help paying for hearing aids', county: '', nickname: '', turnstile_token: 'pass-token:suggest' },
    });
    expect(res.status).toBe(410);
    expect(await countRows('help_suggestions')).toBe(0);
  });

  it('sends the old page address to the directory', async () => {
    const res = await call('/suggest', { sitePublic: true });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location')).pathname).toBe('/');
  });

  it('earlier messages are still only visible to the owner', async () => {
    await env.DB.prepare("INSERT INTO help_suggestions (looking_for, county) VALUES ('Hearing aids', 'Warren')").run();
    expect((await call('/api/admin/suggestions', {})).status).not.toBe(200);
    const ok = await call('/api/admin/suggestions', { as: await token() });
    expect((await ok.json()).suggestions).toHaveLength(1);
  });
});
