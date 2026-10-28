// Anonymous barrier reports (Community needs page). Rule 1: nothing that could
// identify a person is accepted; rule 5: input is untrusted; and the public
// summary only shows totals, hiding any number under 5.

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { call, token, resetDb, countRows, fakeEmail } from './helpers.js';
import { barrierSummary, startOfDayNewYork } from '../src/routes/barriers.js';

let ipCounter = 0;
function report(body, opts = {}) {
  const email = opts.email ?? fakeEmail();
  const b = { county: 'Warren', barriers: ['transportation'], reporter: '', comment: '', nickname: '', turnstile_token: 'pass-token:barrier', ...body };
  return call('/api/barriers', {
    method: 'POST', body: b, sitePublic: true,
    headers: { 'CF-Connecting-IP': opts.ip ?? `198.51.100.${++ipCounter}` },
    envExtra: { SEND_EMAIL: email.binding },
  }).then((res) => ({ res, email }));
}

describe('Barrier reports', () => {
  beforeEach(resetDb);

  it('saves an anonymous report and emails the owner plain text', async () => {
    const { res, email } = await report({ barriers: ['transportation', 'procedure_escort'] });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT * FROM barrier_reports').first();
    expect(row).toMatchObject({ county: 'Warren', comment: '' });
    expect(Object.keys(row).sort()).toEqual(['barriers', 'comment', 'county', 'created_at', 'email_sent', 'id', 'reporter']);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].html).toBeUndefined();
    expect(email.sent[0].text).toContain('anesthesia');
  });

  it('takes no free text: a comment sent anyway is never stored or emailed', async () => {
    const { res, email } = await report({ comment: 'call me at 518-555-1234, my client John Smith' });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare('SELECT comment FROM barrier_reports').first();
    expect(row.comment).toBe('');
    expect(email.sent[0].text).not.toContain('John Smith');
  });

  it('refuses unknown counties, barriers and reporter types', async () => {
    for (const body of [{ county: 'Albany' }, { barriers: ['<script>'] }, { barriers: [] }, { reporter: 'my caseworker Pat' }]) {
      const { res } = await report(body);
      expect(res.status).toBe(422);
    }
    expect(await countRows('barrier_reports')).toBe(0);
  });

  it('quietly drops robots that fill in the trap field, and refuses a failed human check', async () => {
    expect((await report({ nickname: 'bot' })).res.status).toBe(200);
    expect((await report({ turnstile_token: 'fail-token' })).res.status).toBe(403);
    expect(await countRows('barrier_reports')).toBe(0);
  });

  it('limits each sender to 3 reports an hour', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await report({}, { ip: '203.0.113.99' })).res.status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('public summary: only reports before today, rounded down to steps of 5, under 5 hidden', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const add = (county, barriers, comment = '') => env.DB.prepare('INSERT INTO barrier_reports (county, barriers, comment, created_at) VALUES (?, ?, ?, ?)')
      .bind(county, JSON.stringify(barriers), comment, yesterday).run();
    for (let i = 0; i < 7; i++) await add('Saratoga', ['housing_cost'], `secret comment ${i}`);
    for (let i = 0; i < 3; i++) await add('Warren', ['housing_cost', 'food']);
    await report({ county: 'Washington', barriers: ['food'] }); // today: not counted yet
    const res = await call('/api/barriers/summary', { sitePublic: true });
    const text = await res.text();
    expect(text).not.toContain('secret comment');
    const s = JSON.parse(text);
    expect(s.reports).toBe(10);
    const housing = s.barriers.find((b) => b.id === 'housing_cost');
    expect(housing.count).toBe(10);
    expect(housing.by_county.Saratoga).toBe(5);
    expect(housing.by_county.Warren).toBeNull();
    expect(s.barriers.find((b) => b.id === 'food').count).toBeNull();
  });

  it('the day for "before today" is New York\'s, so an evening report never shows the same night', async () => {
    expect(startOfDayNewYork('2026-10-28')).toBe('2026-10-28T04:00:00.000Z'); // daylight time
    expect(startOfDayNewYork('2026-12-15')).toBe('2026-12-15T05:00:00.000Z'); // standard time
    // Reports at 7:59 PM New York on Oct 28 (23:59 UTC). At 8:30 PM the same
    // evening (already Oct 29 in UTC) they must not count yet; the next day they do.
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare("INSERT INTO barrier_reports (county, barriers, reporter, comment, created_at) VALUES ('Warren', '[\"food\"]', '', '', '2026-10-28T23:59:00.000Z')").run();
    }
    const evening = await barrierSummary(env.DB, new Date('2026-10-29T00:30:00Z')); // 8:30 PM in New York
    expect(evening.barriers.find((b) => b.id === 'food').count).toBe(null);
    const nextDay = await barrierSummary(env.DB, new Date('2026-10-29T14:00:00Z'));
    expect(nextDay.barriers.find((b) => b.id === 'food').count).toBe(5);
  });

  it('reports are only visible to the owner', async () => {
    await report({});
    expect((await call('/api/admin/barriers', { sitePublic: true })).status).not.toBe(200);
    const res = await call('/api/admin/barriers', { as: await token() });
    expect((await res.json()).reports).toHaveLength(1);
  });
});
