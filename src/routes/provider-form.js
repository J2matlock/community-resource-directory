// Public provider request form (rule 5: everything here is untrusted).
// Order: size limit → hidden trap field → Turnstile → hourly limit →
// validation → save a copy → email the owner. The saved copy comes first so
// nothing is lost if the email fails.

import { json, readLimited } from '../http.js';
import { validateProviderRequest } from '../validate.js';
import { requestEmail } from '../email.js';
import { sha256, verifyTurnstile, takeHourlySlot } from '../lib/form-guard.js';

const MAX_BYTES = 20_000;
const PER_SENDER_PER_HOUR = 5;
const ALL_PER_HOUR = 50;

export async function handleProviderRequest(request, env, url) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'That is too long. Please shorten your answers.' }, 413);
  const text = await readLimited(request, MAX_BYTES);
  if (text === null) return json({ error: 'That is too long. Please shorten your answers.' }, 413);
  let input;
  try { input = JSON.parse(text); } catch { return json({ error: 'Could not read the form.' }, 400); }
  if (!input || typeof input !== 'object') return json({ error: 'Could not read the form.' }, 400);

  // Hidden trap field: people never see it, robots fill it in. Pretend it worked.
  if (typeof input.nickname === 'string' && input.nickname.trim() !== '') return json({ ok: true }, 200);

  if (!env.IP_SALT) {
    // Without the salt, stored IP hashes could be reversed. Refuse instead.
    console.error('Provider form refused: IP_SALT is not set.');
    return json({ error: 'The form is not available right now. Please try again later.' }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, input.turnstile_token, ip, url.hostname, 'request'))) {
    return json({ error: 'The "are you human" check didn\'t work. Please try again.' }, 403);
  }

  const { value, errors } = validateProviderRequest(input);
  if (!value) return json({ error: 'Please check the highlighted answers.', errors }, 422);

  // Hourly limit, checked and recorded in one step.
  const db = env.DB;
  const ipHash = await sha256(`${env.IP_SALT}|${ip}`);
  if (!(await takeHourlySlot(db, 'request_rate', ipHash, PER_SENDER_PER_HOUR, ALL_PER_HOUR))) {
    return json({ error: 'We\'ve had a lot of requests in the last hour. Please try again later.' }, 429);
  }

  const saved = await db.prepare('INSERT INTO provider_requests (fields) VALUES (?) RETURNING id').bind(JSON.stringify(value)).first();
  const id = saved.id;

  let emailSent = false;
  if (env.SEND_EMAIL && env.EMAIL_FROM && env.FORWARD_TO) {
    try {
      const { subject, text: body } = requestEmail(id, value, `${url.origin}/admin/#/requests`);
      await env.SEND_EMAIL.send({ from: env.EMAIL_FROM, to: env.FORWARD_TO, subject, text: body });
      emailSent = true;
    } catch (err) {
      console.error('Request email failed:', err?.name, err?.message);
    }
  }
  if (emailSent) await db.prepare('UPDATE provider_requests SET email_sent = 1 WHERE id = ?').bind(id).run();
  return json({ ok: true }, 201);
}
