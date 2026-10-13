// Logged-out check of a live address (rule 6). Run after every deploy, for
// every address the site answers on (custom domain AND workers.dev).
//   node scripts/live-check.mjs https://example.org [--launched]
// Before launch every page must be refused or sent to the login. After launch
// the directory and form are public, and admin pages and saves stay refused.

const base = (process.argv[2] || '').replace(/\/+$/, '');
const launched = process.argv.includes('--launched');
if (!/^https:\/\//.test(base)) { console.error('Usage: node scripts/live-check.mjs https://address [--launched]'); process.exit(1); }

const results = [];
async function check(label, path, { method = 'GET', body, expectPublic = false } = {}) {
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
  const ok = expectPublic ? res.status === 200 && !leak : refused;
  results.push({ ok, label, detail: `${method} ${path} → ${res.status}${toLogin ? ' (login page)' : ''}${leak ? ' PRIVATE FIELD FOUND' : ''}` });
}

await check('Directory page', '/', { expectPublic: launched });
await check('Public listings data', '/api/listings', { expectPublic: launched });
await check('A listing link', '/listing/test', { expectPublic: launched });
await check('Request form', '/request', { expectPublic: launched });
await check('Admin page', '/admin/');
await check('Admin data', '/api/admin/listings');
await check('Admin export', '/api/admin/export');
await check('Save without login', '/api/admin/listings', { method: 'POST', body: { name: 'x' } });
await check('Change list without login', '/api/admin/lists/categories', { method: 'POST', body: { name: 'x' } });
await check('To review list', '/api/admin/review');
await check('Answer without login', '/api/admin/review/1', { method: 'POST', body: { status: 'done' } });
await check('Pause switch without login', '/api/admin/pause', { method: 'PUT', body: { paused: true } });

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(28)} ${r.detail}`);
  if (!r.ok) failed++;
}
console.log(failed ? `\n${failed} check(s) FAILED for ${base}` : `\nAll checks passed for ${base} (${launched ? 'launched' : 'pre-launch'} mode).`);
process.exit(failed ? 1 : 0);
