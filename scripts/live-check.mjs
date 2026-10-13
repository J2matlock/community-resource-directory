// Logged-out check of a live address (rule 6). Run after every deploy, for
// every address the site answers on (custom domain AND workers.dev).
//   node scripts/live-check.mjs https://example.org [--launched]
// Before launch every page must be refused or sent to the login. After launch
// the directory and form are public, and admin pages and saves stay refused.

const base = (process.argv[2] || '').replace(/\/+$/, '');
const launched = process.argv.includes('--launched');
if (!/^https:\/\//.test(base)) { console.error('Usage: node scripts/live-check.mjs https://address [--launched]'); process.exit(1); }

const results = [];
// `expectStatus`: the one status the address must answer with (e.g. 404 for a
// made-up page); otherwise the address must be public (200) or refused.
async function check(label, path, { method = 'GET', body, expectPublic = false, expectStatus = 0 } = {}) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: body ? { 'Content-Type': 'application/json', Origin: base } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const loc = res.headers.get('location') || '';
  const toLogin = res.status >= 300 && res.status < 400 && /cloudflareaccess\.com/.test(loc);
  const refused = res.status === 401 || res.status === 403 || toLogin;
  const text = res.status === 200 ? await res.text() : '';
  const leak = /private_notes|"visibility"|"retired"/.test(text);
  const ok = expectStatus ? res.status === expectStatus : expectPublic ? res.status === 200 && !leak : refused;
  results.push({ ok, label, detail: `${method} ${path} → ${res.status}${toLogin ? ' (login page)' : ''}${leak ? ' PRIVATE FIELD FOUND' : ''}` });
}

await check('Directory page', '/', { expectPublic: launched });
await check('Public listings data', '/api/listings', { expectPublic: launched });
// A real listing's own link (a made-up id now correctly answers 404).
let listingPath = '/listing/test';
if (launched) {
  try {
    const first = (await (await fetch(`${base}/api/listings`)).json()).listings?.[0];
    if (first?.id) listingPath = `/listing/${first.id}`;
  } catch { /* fall back to the made-up id; the check will say so */ }
}
await check('A listing link', listingPath, { expectPublic: launched });
await check('Request form', '/request', { expectPublic: launched });
await check('Admin page', '/admin/');
await check('Admin data', '/api/admin/listings');
await check('Admin export', '/api/admin/export');
await check('Save without login', '/api/admin/listings', { method: 'POST', body: { name: 'x' } });
await check('Change list without login', '/api/admin/lists/categories', { method: 'POST', body: { name: 'x' } });
await check('To review list', '/api/admin/review');
await check('Answer without login', '/api/admin/review/1', { method: 'POST', body: { status: 'done' } });
await check('Pause switch without login', '/api/admin/pause', { method: 'PUT', body: { paused: true } });
// Before launch the login covers every page, so a made-up address is refused
// like the rest; after launch it must answer "not found".
if (launched) await check('Made-up page is 404', '/this-page-does-not-exist', { expectStatus: 404 });

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(28)} ${r.detail}`);
  if (!r.ok) failed++;
}
console.log(failed ? `\n${failed} check(s) FAILED for ${base}` : `\nAll checks passed for ${base} (${launched ? 'launched' : 'pre-launch'} mode).`);
process.exit(failed ? 1 : 0);
