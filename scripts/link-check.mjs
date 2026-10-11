// Broken-link check for everything the public sees. Reads only PUBLIC data from
// the live site (never the database), checks each web link once, and writes a
// plain-language report to data/ (local only, kept out of git).
//   node scripts/link-check.mjs [--base https://southernadkhelp.org]
//                               [--out data/link-check-YYYY-MM-DD.md]
//                               [--only listings|content]
//
// Where links come from:
//   listings  every `website` in <base>/api/listings (the public listings feed)
//   content   every source `url` and every donate/volunteer/wishlist link in
//             <base>/content/learn.json, needs.json and help.json
//
// How each link is checked (politely: 4 at a time, at most 2 per website, an
// ordinary browser identity, 15 seconds each): HEAD first, then GET if HEAD is
// refused or doesn't come back OK; redirects followed up to 5. Server errors
// (5xx) and dropped connections get one retry 30 seconds later.
//
// Groups in the report:
//   Broken         404/410, the website's name no longer exists, connection
//                  refused, an expired or wrong security certificate, or a
//                  server error twice in a row. Fix or remove these.
//   Moved          permanently redirected to a different site or page. The
//                  report shows the new address so the link can be updated.
//   Check by hand  blocked by bot protection (403/429/503, "Just a moment",
//                  captcha), too slow, or something unusual. Open these in a
//                  browser; most work fine for people.
//   OK             only counted.
//
// It's a report, not a test: it always exits 0 once the report is written.
// The only network traffic is fetching the public data and the plain HEAD/GET
// to each link. Nothing is sent anywhere else.

import { promises as dns } from 'node:dns';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONCURRENCY = 4;
const PER_HOST = 2;
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_MS = 30_000;
const MAX_REDIRECTS = 5;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ---- Options ----
function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const base = (arg('--base') || 'https://southernadkhelp.org').replace(/\/+$/, '');
const outPath = resolve(ROOT, arg('--out') || `data/link-check-${ymd}.md`);
const only = arg('--only');
if (!/^https?:\/\//.test(base) || (only && !['listings', 'content'].includes(only))) {
  console.error('Usage: node scripts/link-check.mjs [--base https://address] [--out data/file.md] [--only listings|content]');
  process.exit(1);
}

// ---- 1. Collect links and where each one is used ----
const uses = new Map(); // url -> [{ text, href }]
function addUse(rawUrl, text, href = '') {
  const url = String(rawUrl || '').trim();
  if (!url || /^(mailto|tel|sms):/i.test(url)) return;
  const key = url.split('#')[0];
  if (!uses.has(key)) uses.set(key, []);
  const list = uses.get(key);
  if (!list.some((u) => u.text === text)) list.push({ text, href });
}

async function getJson(path) {
  const res = await fetch(base + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${base}${path} answered ${res.status}`);
  return res.json();
}

try {
  if (only !== 'content') {
    const data = await getJson('/api/listings');
    for (const l of data.listings || []) {
      if (l.website) addUse(l.website, `Listing: ${l.name}`, `${base}/admin/#/edit/${encodeURIComponent(l.id)}`);
    }
  }
  if (only !== 'listings') {
    const learn = await getJson('/content/learn.json');
    for (const s of learn.sections || []) {
      for (const e of s.entries || []) {
        for (const src of e.sources || []) addUse(src.url, `Learn: ${e.q}`);
      }
    }
    const needs = await getJson('/content/needs.json');
    for (const src of needs.intro_sources || []) addUse(src.url, 'Community needs: introduction');
    for (const g of needs.gaps || []) {
      for (const src of g.sources || []) addUse(src.url, `Community needs: ${g.title}`);
    }
    const help = await getJson('/content/help.json');
    for (const o of [...(help.orgs || []), ...(help.no_online_page || [])]) {
      for (const [k, v] of Object.entries(o)) {
        if (/(^|_)url$/.test(k) && typeof v === 'string') {
          const kind = k.replace(/_?url$/, '') || 'link';
          addUse(v, `Ways to help: ${o.name} (${kind === 'wishlist' ? 'items they need' : kind} link)`);
        }
      }
    }
  }
} catch (err) {
  console.error(`Could not read the public data: ${err.message}`);
  process.exit(1);
}

// ---- 2. Check each link ----
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const BOT_TEXT = /just a moment|checking your browser|cf-browser-verification|challenge-platform|captcha|attention required|verify you are human|are you a robot|access denied|incapsula|datadome|perimeterx|sucuri|ddos protection|request unsuccessful|bot detection/i;
const BROKEN_TLS = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_REVOKED']);
const INCOMPLETE_TLS = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const DROPPED = new Set(['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE']);
const SHORT_LINKS = new Set(['a.co', 'amzn.to', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly', 'rebrand.ly']);
const TIMEOUTS = new Set(['TimeoutError', 'AbortError', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT']);

// Reads at most `max` bytes of a page, enough to spot a bot-protection page.
async function peek(res, max = 65_536) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let got = 0;
  try {
    while (got < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
  } catch { /* partial page is fine */ }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

// One request, following redirects by hand so each hop is recorded.
async function follow(url, method) {
  const chain = [];
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, { method, redirect: 'manual', headers: HEADERS, signal });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(location, current).href;
        chain.push({ status: res.status, to: next });
        current = next;
        continue;
      }
      const looksBlocked = [403, 429, 503].includes(res.status);
      const body = method === 'GET' && (looksBlocked || res.status >= 400) ? await peek(res) : '';
      if (!body) await res.body?.cancel().catch(() => {});
      return { status: res.status, headers: res.headers, body, chain, finalUrl: current };
    }
    return { tooManyRedirects: true, chain, finalUrl: current };
  } catch (err) {
    const timedOut = [err.name, err.cause?.name].includes('TimeoutError');
    const code = timedOut ? 'TimeoutError' : err.cause?.code || err.code || err.name;
    return { error: code, message: err.cause?.message || err.message, chain, finalUrl: current };
  }
}

// Returns { group, reason, finalUrl?, retry? }.
async function check(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return { group: 'broken', reason: 'Not a valid web address' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { group: 'broken', reason: 'Not a web address' };

  let r = await follow(url, 'HEAD');
  const headOk = r.status >= 200 && r.status < 300;
  const definite = r.error && (r.error === 'ENOTFOUND' || r.error === 'ECONNREFUSED' || BROKEN_TLS.has(r.error) || INCOMPLETE_TLS.has(r.error));
  if (!headOk && !definite && !r.tooManyRedirects) r = await follow(url, 'GET');
  return classify(url, r);
}

async function classify(url, r) {
  const via = r.chain.length ? ` (after redirect to ${r.finalUrl})` : '';
  if (r.tooManyRedirects) return { group: 'hand', reason: `More than ${MAX_REDIRECTS} redirects` };
  if (r.error) {
    const e = r.error;
    if (TIMEOUTS.has(e)) return { group: 'timeout', reason: `No answer in ${TIMEOUT_MS / 1000} seconds${via}` };
    if (e === 'ENOTFOUND') {
      // Double-check with the computer's own lookup before calling it gone.
      try { await dns.lookup(new URL(r.finalUrl).hostname); return { retry: true, group: 'hand', reason: 'Website name lookup failed once, then worked' }; }
      catch { return { group: 'broken', reason: `Website name not found (DNS)${via}. If it opens in your browser, your network is filtering it` }; }
    }
    if (e === 'EAI_AGAIN') return { retry: true, group: 'hand', reason: 'Website name lookup failed (temporary)' };
    if (e === 'ECONNREFUSED') return { group: 'broken', reason: `Connection refused${via}` };
    if (BROKEN_TLS.has(e)) return { group: 'broken', reason: `Security certificate problem: ${e === 'CERT_HAS_EXPIRED' ? 'expired' : e === 'ERR_TLS_CERT_ALTNAME_INVALID' ? 'issued for a different website' : e}${via}` };
    if (DROPPED.has(e)) return { retry: true, group: 'blocked', reason: 'Connection dropped (usually bot protection)' };
    if (INCOMPLETE_TLS.has(e)) return { group: 'hand', reason: 'Security certificate set up incompletely (most browsers still open it)' };
    return { retry: true, group: 'hand', reason: `Connection problem (${e})${via}` };
  }

  const s = r.status;
  const server = r.headers.get('server') || '';
  const botHeader = r.headers.get('cf-mitigated') || r.headers.get('x-datadome') || r.headers.get('x-sucuri-id') || r.headers.get('x-iinfo');
  if (s >= 200 && s < 300) {
    const permanent = r.chain.some((h) => h.status === 301 || h.status === 308);
    // Short links (a.co, bit.ly) always redirect, and a home page sending you to
    // /en/home on the same site is still the right address. Neither is "moved".
    const shortLink = SHORT_LINKS.has(hostOf(url));
    const homeOnSameSite = new URL(url).pathname.replace(/\/+$/, '') === '' && hostOf(url) === hostOf(r.finalUrl);
    if (permanent && !shortLink && !homeOnSameSite && !sameish(url, r.finalUrl)) {
      const toHome = new URL(r.finalUrl).pathname.replace(/\/+$/, '') === '' && new URL(url).pathname.replace(/\/+$/, '') !== '';
      return { group: 'moved', finalUrl: r.finalUrl, reason: toHome ? 'Sent to the home page; the page may be gone' : hostOf(url) !== hostOf(r.finalUrl) ? 'Now on a different website' : 'Moved to a new page' };
    }
    return { group: 'ok' };
  }
  if (s === 404 || s === 410) return { group: 'broken', reason: `Page not found (${s})${via}` };
  if ([403, 429, 503].includes(s) && (botHeader || BOT_TEXT.test(r.body) || /cloudflare|akamai/i.test(server))) {
    return { group: 'blocked', reason: `Bot protection (${s}${/cloudflare/i.test(server) ? ', Cloudflare' : /akamai/i.test(server) ? ', Akamai' : ''})` };
  }
  if (s === 403 || s === 429 || s === 401) return { group: 'blocked', reason: `Refused the automated check (${s})` };
  if (s >= 500) return { retry: true, group: 'broken', reason: `Server error (${s}) twice in a row${via}` };
  return { group: 'hand', reason: `Unusual answer (${s})${via}` };
}

// Same place, ignoring http/https, "www.", a trailing slash, index pages and letter case.
function sameish(a, b) {
  const n = (u) => {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/index\.(html?|php|aspx?)$/i, '').replace(/\/+$/, '') + x.search).toLowerCase();
  };
  return n(a) === n(b);
}

// Small scheduler: 4 at a time overall, 2 per website, retries wait 30 seconds.
const results = new Map();
const started = Date.now();
const total = uses.size;
const queue = [...uses.keys()].map((url) => ({ url, notBefore: 0, attempt: 1 }));
let active = 0;
let done = 0;
const perHost = new Map();
let timer = null;

function progress() {
  if (process.stdout.isTTY) process.stdout.write(`\r  Checked ${done} of ${total}...`);
  else if (done % 100 === 0) console.log(`  Checked ${done} of ${total}...`);
}

console.log(`Checking ${total} links from ${base}${only ? ` (${only} only)` : ''}...`);
await new Promise((finish) => {
  function pump() {
    if (!queue.length && !active) return finish();
    const now = Date.now();
    for (let i = 0; i < queue.length && active < CONCURRENCY; i++) {
      const job = queue[i];
      const host = hostOf(job.url);
      if (job.notBefore > now || (perHost.get(host) || 0) >= PER_HOST) continue;
      queue.splice(i--, 1);
      active++;
      perHost.set(host, (perHost.get(host) || 0) + 1);
      check(job.url)
        .catch((err) => ({ group: 'hand', reason: `Checker error: ${err.message}` }))
        .then((res) => {
          if (res.retry && job.attempt === 1) {
            queue.push({ url: job.url, notBefore: Date.now() + RETRY_AFTER_MS, attempt: 2 });
          } else {
            results.set(job.url, res);
            done++;
            progress();
          }
        })
        .finally(() => {
          active--;
          perHost.set(host, perHost.get(host) - 1);
          pump();
        });
    }
    const waiting = queue.filter((j) => j.notBefore > now).map((j) => j.notBefore);
    if (waiting.length && !timer) {
      timer = setTimeout(() => { timer = null; pump(); }, Math.max(50, Math.min(...waiting) - now));
    }
  }
  pump();
});
if (process.stdout.isTTY) process.stdout.write('\n');

// ---- 3 and 4. Sort and write the report ----
const seconds = Math.round((Date.now() - started) / 1000);
const by = { broken: [], moved: [], blocked: [], timeout: [], hand: [], ok: [] };
for (const [url, res] of results) by[res.group].push({ url, ...res, used: uses.get(url) });
const handCount = by.blocked.length + by.timeout.length + by.hand.length;

const summary = [
  `Checked ${total} web links on ${base.replace(/^https?:\/\//, '')}: ${by.ok.length} work, ${by.broken.length} are broken, ${by.moved.length} have moved, and ${handCount} need a quick check by hand.`,
  'Broken links should be fixed or removed. Moved links can usually be updated to the new address shown.',
  'Check-by-hand links were blocked or slow for this automatic check. Open them in a browser; most work fine for people.',
];

const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const usedOn = (list) => list.map((u) => (u.href ? `[${cell(u.text).replace(/[[\]]/g, '')}](${u.href})` : cell(u.text))).join('<br>');
const order = (rows) => rows.sort((a, b) => b.used.length - a.used.length || a.url.localeCompare(b.url));

const md = [`# Link check, ${ymd}`, '', ...summary.map((l) => `${l}  `), '',
  `Run time: ${Math.floor(seconds / 60)} min ${seconds % 60} s. OK links are not listed (${by.ok.length}).`, ''];

md.push(`## Broken (${by.broken.length})`, '');
if (by.broken.length) {
  md.push('| Link | Problem | Used on |', '| --- | --- | --- |');
  for (const r of order(by.broken)) md.push(`| ${cell(r.url)} | ${cell(r.reason)} | ${usedOn(r.used)} |`);
} else md.push('None.');
md.push('', `## Moved (${by.moved.length})`, '');
if (by.moved.length) {
  md.push('| Link | Now goes to | Note | Used on |', '| --- | --- | --- | --- |');
  for (const r of order(by.moved)) md.push(`| ${cell(r.url)} | ${cell(r.finalUrl)} | ${cell(r.reason)} | ${usedOn(r.used)} |`);
} else md.push('None.');
const hand = [...order(by.blocked).map((r) => ({ ...r, kind: 'Blocked' })), ...order(by.timeout).map((r) => ({ ...r, kind: 'Timeout' })), ...order(by.hand).map((r) => ({ ...r, kind: 'Other' }))];
md.push('', `## Check by hand: blocked ${by.blocked.length}, timed out ${by.timeout.length}, other ${by.hand.length}`, '');
if (hand.length) {
  md.push('| Link | Kind | Why | Used on |', '| --- | --- | --- | --- |');
  for (const r of hand) md.push(`| ${cell(r.url)} | ${r.kind} | ${cell(r.reason)} | ${usedOn(r.used)} |`);
} else md.push('None.');
md.push('');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md.join('\n'));

// ---- 5. Console summary ----
console.log('');
for (const l of summary) console.log(l);
console.log(`\nBroken ${by.broken.length} | Moved ${by.moved.length} | Blocked ${by.blocked.length} | Timeout ${by.timeout.length} | Other ${by.hand.length} | OK ${by.ok.length}`);
console.log(`Run time: ${Math.floor(seconds / 60)} min ${seconds % 60} s`);
console.log(`Report: ${outPath}`);
process.exit(0);
