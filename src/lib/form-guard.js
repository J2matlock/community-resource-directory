// Shared protections for the public forms (rule 5): Turnstile check and a
// per-sender hourly limit keyed by a salted hash of the IP address (the
// address itself is never stored).

import { json, readLimited } from '../http.js';

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cloudflare's documented test secrets ("1x000…", "2x000…", "3x000…") don't
// report the real hostname; they're only ever used on this computer.
function isTestSecret(secret) {
  return /^[123]x0{20,}/.test(secret);
}

// `action` names the form (set as data-action on its widget), so a pass
// earned on one form can't be spent on another.
export async function verifyTurnstile(env, token, ip, hostname, action) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.error('Turnstile refused: TURNSTILE_SECRET_KEY is not set (run wrangler secret put TURNSTILE_SECRET_KEY).');
    return false;
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const out = await res.json();
    // Logs only Cloudflare's error codes and whether the address and form
    // matched: never the token, the IP address or anything typed (rule 1).
    if (out.success !== true) {
      console.error('Turnstile refused:', JSON.stringify(out['error-codes'] ?? []));
      return false;
    }
    if (isTestSecret(env.TURNSTILE_SECRET_KEY)) return true;
    const ok = out.hostname === hostname && out.action === action;
    if (!ok) console.error('Turnstile mismatch:', JSON.stringify({ hostname_ok: out.hostname === hostname, action_expected: action, action_got: String(out.action ?? '').slice(0, 32) }));
    return ok;
  } catch (err) {
    console.error('Turnstile check failed:', err?.name);
    return false;
  }
}

// Checks and records one use in the same step, so requests sent at the same
// moment can't slip past the limit. `table` is a fixed table name from this
// code, never user input. Returns true if this request is allowed.
export async function takeHourlySlot(db, table, ipHash, perSender, overall) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table name');
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [slot] = await db.batch([
    db.prepare(`INSERT INTO ${table} (ip_hash) SELECT ?
      WHERE (SELECT COUNT(*) FROM ${table} WHERE ip_hash = ? AND created_at > ?) < ?
        AND (SELECT COUNT(*) FROM ${table} WHERE created_at > ?) < ?`)
      .bind(ipHash, ipHash, hourAgo, perSender, hourAgo, overall),
    db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).bind(dayAgo),
  ]);
  return slot.meta.changes === 1;
}

// The opening steps shared by the anonymous forms: JSON only, size limit,
// trap field, settings present, Turnstile. Returns { input, ip } to carry on,
// or { response } to send back straight away.
export async function readAnonymousForm(request, env, url, maxBytes, label, action) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return { response: json({ error: 'Send JSON.' }, 415) };
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return { response: json({ error: 'That is too long.' }, 413) };
  const text = await readLimited(request, maxBytes);
  if (text === null) return { response: json({ error: 'That is too long.' }, 413) };
  let input;
  try { input = JSON.parse(text); } catch { return { response: json({ error: 'Could not read the form.' }, 400) }; }
  if (!input || typeof input !== 'object') return { response: json({ error: 'Could not read the form.' }, 400) };
  if (typeof input.nickname === 'string' && input.nickname.trim() !== '') return { response: json({ ok: true }, 200) };
  if (!env.IP_SALT) {
    console.error(`${label} refused: IP_SALT is not set.`);
    return { response: json({ error: 'The form is not available right now. Please try again later.' }, 503) };
  }
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, input.turnstile_token, ip, url.hostname, action))) {
    return { response: json({ error: 'The "are you human" check didn\'t work. Please try again.' }, 403) };
  }
  return { input, ip };
}
