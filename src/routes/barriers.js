// Anonymous "barriers to getting help" reports (Community needs page).
// Same order as the provider form: size limit, trap field, Turnstile, checks,
// hourly limit, save, email the owner. The public summary only ever returns
// totals, and hides any number under 5 so no one can be singled out.

import { todayLocal } from '../db/admin.js';
import { json } from '../http.js';
import { validateBarrierReport, BARRIERS, BARRIER_COUNTIES } from '../validate.js';
import { barrierEmail } from '../email.js';
import { sha256, takeHourlySlot, readAnonymousForm } from '../lib/form-guard.js';

const MAX_BYTES = 8_000;
const PER_SENDER_PER_HOUR = 3;
const ALL_PER_HOUR = 60;
export const MIN_SHOWN = 5;

export async function handleBarrierReport(request, env, url) {
  const { input, ip, response } = await readAnonymousForm(request, env, url, MAX_BYTES, 'Barrier form', 'barrier');
  if (response) return response;
  const { value, errors } = validateBarrierReport(input);
  if (!value) return json({ error: 'Please check the highlighted answers.', errors }, 422);

  const db = env.DB;
  const ipHash = await sha256(`${env.IP_SALT}|${ip}`);
  if (!(await takeHourlySlot(db, 'barrier_rate', ipHash, PER_SENDER_PER_HOUR, ALL_PER_HOUR))) {
    return json({ error: 'We\'ve had a lot of reports in the last hour. Please try again later.' }, 429);
  }
  const saved = await db.prepare('INSERT INTO barrier_reports (county, barriers, reporter, comment) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(value.county, JSON.stringify(value.barriers), value.reporter, value.comment).first();
  if (env.SEND_EMAIL && env.EMAIL_FROM && env.FORWARD_TO) {
    try {
      const { subject, text: body } = barrierEmail(saved.id, value);
      await env.SEND_EMAIL.send({ from: env.EMAIL_FROM, to: env.FORWARD_TO, subject, text: body });
      await db.prepare('UPDATE barrier_reports SET email_sent = 1 WHERE id = ?').bind(saved.id).run();
    } catch (err) {
      console.error('Barrier email failed:', err?.name, err?.message);
    }
  }
  return json({ ok: true }, 201);
}

// Public totals, privacy-protected three ways: (1) only reports from before
// today (New York time) count, so a new report never changes the page right
// away, even in the evening (UTC's day ends at 7 or 8 PM here); (2)
// every number is rounded down to a step of 5 and shown as "N+"; (3) anything
// under 5 is hidden (null). Rounding stops anyone working out a hidden number
// by subtracting the counties that are shown.
// The moment a New York day starts, as a UTC time like the saved reports'
// (midnight in New York is 04:00 or 05:00 UTC, depending on daylight time).
export function startOfDayNewYork(day) {
  for (const h of ['04', '05']) {
    const t = new Date(`${day}T${h}:00:00.000Z`);
    if (todayLocal(t) === day && todayLocal(new Date(t.getTime() - 1)) !== day) return t.toISOString();
  }
  return `${day}T05:00:00.000Z`;
}

export async function barrierSummary(db, now = new Date()) {
  const today = todayLocal(now);
  const { results } = await db.prepare('SELECT county, barriers FROM barrier_reports WHERE created_at < ?').bind(startOfDayNewYork(today)).all();
  const step = (n) => (n >= MIN_SHOWN ? Math.floor(n / MIN_SHOWN) * MIN_SHOWN : null);
  const byBarrier = Object.fromEntries(BARRIERS.map(([id]) => [id, { all: 0, byCounty: Object.fromEntries(BARRIER_COUNTIES.map((c) => [c, 0])) }]));
  for (const r of results) {
    let list = [];
    try { list = JSON.parse(r.barriers); } catch { /* skip */ }
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      if (!byBarrier[b]) continue;
      byBarrier[b].all++;
      if (r.county in byBarrier[b].byCounty) byBarrier[b].byCounty[r.county]++;
    }
  }
  return {
    min_shown: MIN_SHOWN,
    as_of: today,
    reports: step(results.length),
    barriers: BARRIERS.map(([id, label]) => ({
      id, label, count: step(byBarrier[id].all),
      by_county: Object.fromEntries(BARRIER_COUNTIES.map((c) => [c, step(byBarrier[id].byCounty[c])])),
    })),
  };
}
