// Community needs page: the county dropdown on the anonymous barrier form is
// written into the page itself, so the form works even when the totals
// request fails. Its choices must match what the server accepts
// (BARRIER_COUNTIES in src/validate.js).

import { describe, it, expect } from 'vitest';
import { call } from './helpers.js';
import { REGION } from '../src/region.js';
import { BARRIER_COUNTIES } from '../src/validate.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('Community needs page', () => {
  it('the county dropdown lists every county and "Other or prefer not to say" in the HTML', async () => {
    const html = await (await call('/needs', { sitePublic: true })).text();
    const m = html.match(/<select id="county"[^>]*>([\s\S]*?)<\/select>/);
    expect(m).not.toBeNull();
    const select = m[1];
    expect(select).toContain('<option value="">Choose…</option>');
    for (const county of REGION.counties) expect(select).toMatch(new RegExp(`<option>${esc(county)}</option>`));
    expect(select).toContain('<option>Other or prefer not to say</option>');
    const onPage = [...select.matchAll(/<option>([^<]+)<\/option>/g)].map((x) => x[1]);
    expect(onPage).toEqual(BARRIER_COUNTIES);
  });
});
