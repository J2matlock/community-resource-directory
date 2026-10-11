// Response helpers and security headers shared by every route.

export const MAX_JSON_BYTES = 100_000;

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function withSecurityHeaders(response, { privateResponse }) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (privateResponse) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function notAvailable(path) {
  if (path.startsWith('/api/')) return json({ error: 'Not available.' }, 403);
  return new Response('Not available.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function notFound(path) {
  if (path.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
  return new Response('Page not found.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Writes must come from a page on this same site (blocks cross-site forms).
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return { error: json({ error: 'Send JSON.' }, 415) };
  }
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_JSON_BYTES) return { error: json({ error: 'Too large.' }, 413) };
  const text = await readLimited(request, MAX_JSON_BYTES);
  if (text === null) return { error: json({ error: 'Too large.' }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: 'Could not read the request.' }, 400) };
  }
}

// Reads the body as text, stopping as soon as it passes `maxBytes`, so a huge
// body (even without a Content-Length header) is never held in memory.
export async function readLimited(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(all);
}
