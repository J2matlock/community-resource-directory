// Weekly backup: emails a full copy (JSON) and a readable copy (Excel) to the
// owner's verified address only.

import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext, createScheduledController } from 'cloudflare:test';
import worker from '../src/index.js';
import { resetDb, fakeEmail } from './helpers.js';
import { buildBackup } from '../src/backup.js';
import { PRIVATE_MARKER } from './fixtures/sample-listings.js';

describe('Weekly backup', () => {
  beforeEach(resetDb);

  it('includes every table, private notes too', async () => {
    const b = await buildBackup(env.DB);
    expect(Object.keys(b.tables).sort()).toEqual(['barrier_reports', 'categories', 'help_suggestions', 'listing_history', 'listing_reports', 'listings', 'medicaid_plans', 'provider_requests', 'review_items', 'site_notice']);
    expect(b.tables.listings).toHaveLength(5);
    expect(b.tables.site_notice).toHaveLength(1); // the notice and pause switch
    expect(JSON.stringify(b)).toContain(PRIVATE_MARKER);
  });

  it('emails two attachments on the weekly schedule', async () => {
    const email = fakeEmail();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 11 * * 1' }), { ...env, SEND_EMAIL: email.binding }, ctx);
    await waitOnExecutionContext(ctx);
    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0];
    expect(msg.to).toBe(env.FORWARD_TO); // the owner's address comes from a secret, never the code
    expect(msg.subject).toMatch(/^Weekly directory backup \d{4}-\d{2}-\d{2} \(5 listings\)$/);
    expect(msg.attachments.map((a) => a.filename.split('.').pop())).toEqual(['json', 'xlsx']);
    const restored = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(msg.attachments[0].content), (c) => c.charCodeAt(0))));
    expect(restored.tables.listings).toHaveLength(5);
  });

  it('sends nothing when the forwarding address is not set', async () => {
    const email = fakeEmail();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 11 * * 1' }), { ...env, SEND_EMAIL: email.binding, FORWARD_TO: '' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(email.sent).toHaveLength(0);
  });

  it('does nothing (and does not crash) before email is set up', async () => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 11 * * 1' }), { ...env, SEND_EMAIL: undefined }, ctx);
    await waitOnExecutionContext(ctx);
  });
});
