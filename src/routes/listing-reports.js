// One-tap "This didn't work" reports (owner decision, 2026-10-12). Same
// protections as the other anonymous forms: size limit, trap field, Turnstile,
// hourly limit. Only a listing id and one of three reasons are stored; nothing
// is shown publicly and a report never changes a listing.

import { json } from '../http.js';
import { validateListingReport } from '../validate.js';
import { sha256, takeHourlySlot, readAnonymousForm } from '../lib/form-guard.js';

const MAX_BYTES = 4_000;
const PER_SENDER_PER_HOUR = 5;
const ALL_PER_HOUR = 200;
const PER_LISTING_PER_HOUR = 3;

export async function handleListingReport(request, env, url) {
  const { input, ip, response } = await readAnonymousForm(request, env, url, MAX_BYTES, 'Listing report', 'report');
  if (response) return response;
  const { value, errors } = validateListingReport(input);
  if (!value) return json({ error: 'Could not send that report.', errors }, 422);
  const db = env.DB;
  // Only public, active listings take reports. Anything else gets the same
  // "thanks" so the reply never reveals whether a hidden listing exists.
  const listing = await db.prepare("SELECT id FROM listings WHERE id = ? AND visibility = 'Public' AND retired = 0").bind(value.listing_id).first();
  if (!listing) return json({ ok: true }, 200);
  const ipHash = await sha256(`${env.IP_SALT}|${ip}`);
  if (!(await takeHourlySlot(db, 'report_rate', ipHash, PER_SENDER_PER_HOUR, ALL_PER_HOUR))) {
    return json({ error: 'We\'ve had a lot of reports in the last hour. Please try again later.' }, 429);
  }
  // At most a few per listing per hour, so one listing can't be flooded. Extra
  // reports get the same thanks but aren't stored.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  await db.prepare(`INSERT INTO listing_reports (listing_id, reason) SELECT ?, ?
    WHERE (SELECT COUNT(*) FROM listing_reports WHERE listing_id = ? AND created_at > ?) < ?`)
    .bind(value.listing_id, value.reason, value.listing_id, hourAgo, PER_LISTING_PER_HOUR).run();
  return json({ ok: true }, 201);
}
