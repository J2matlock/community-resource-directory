// Anonymous "Don't see the help you need?" messages from the directory.
// Same protections as the barrier form: size limit, trap field, Turnstile,
// checks that refuse anything identifying, hourly limit. Saved for the owner
// and emailed to them; nothing from this form is ever shown publicly.

import { json } from '../http.js';
import { validateSuggestion } from '../validate.js';
import { suggestionEmail } from '../email.js';
import { sha256, takeHourlySlot, readAnonymousForm } from '../lib/form-guard.js';

const MAX_BYTES = 4_000;
const PER_SENDER_PER_HOUR = 3;
const ALL_PER_HOUR = 60;

export async function handleSuggestion(request, env, url) {
  const { input, ip, response } = await readAnonymousForm(request, env, url, MAX_BYTES, 'Suggestion form', 'suggest');
  if (response) return response;
  const { value, errors } = validateSuggestion(input);
  if (!value) return json({ error: 'Please check the highlighted answers.', errors }, 422);

  const db = env.DB;
  const ipHash = await sha256(`${env.IP_SALT}|${ip}`);
  if (!(await takeHourlySlot(db, 'suggestion_rate', ipHash, PER_SENDER_PER_HOUR, ALL_PER_HOUR))) {
    return json({ error: 'We\'ve had a lot of messages in the last hour. Please try again later.' }, 429);
  }
  const saved = await db.prepare('INSERT INTO help_suggestions (looking_for, county) VALUES (?, ?) RETURNING id')
    .bind(value.looking_for, value.county).first();
  if (env.SEND_EMAIL && env.EMAIL_FROM && env.FORWARD_TO) {
    try {
      const { subject, text } = suggestionEmail(saved.id, value);
      await env.SEND_EMAIL.send({ from: env.EMAIL_FROM, to: env.FORWARD_TO, subject, text });
      await db.prepare('UPDATE help_suggestions SET email_sent = 1 WHERE id = ?').bind(saved.id).run();
    } catch (err) {
      console.error('Suggestion email failed:', err?.name, err?.message);
    }
  }
  return json({ ok: true }, 201);
}
