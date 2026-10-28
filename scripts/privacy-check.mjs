// Privacy checks run by `npm run check` alongside the tests.
// - Public pages never mention private fields (rule 4).
// - The owner's email is not in any file headed for GitHub (settings rule).
// - No listing data, backups or secrets are tracked by git (rule 8).
// - No SSN-shaped numbers in tracked files (rule 1).
// - No third-party scripts in pages besides Turnstile (rule 7; search is our own
//   public/js/search.js, Fuse.js is not used).
// - Hotline numbers outside the crisis bar match src/region.js.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const failures = [];
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => existsSync(f) && statSync(f).isFile());

// Rule 8: these must never be tracked.
for (const f of tracked) {
  if (/^data\//.test(f) && f !== 'data/README.md') failures.push(`${f} is listing data and must not go to GitHub.`);
  if (/^backups\//.test(f)) failures.push(`${f} is a backup and must not go to GitHub.`);
  if (/(^|\/)\.dev\.vars|(^|\/)\.env/.test(f)) failures.push(`${f} holds secrets and must not go to GitHub.`);
}

const adminEmail = existsSync('.dev.vars')
  ? (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_EMAIL=(.+)$/m)?.[1] ?? '').trim().toLowerCase()
  : '';

const textFiles = tracked.filter((f) => !/\.(png|jpe?g|gif|webp|ico|woff2?|xlsx|zip|pdf)$/i.test(f) && !f.endsWith('package-lock.json'));
for (const f of textFiles) {
  const text = readFileSync(f, 'utf8');
  if (adminEmail && text.toLowerCase().includes(adminEmail)) failures.push(`${f} contains the owner's email address.`);
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) && !/^(test|scripts|src\/validate|\.claude)/.test(f)) {
    failures.push(`${f} contains a number shaped like a Social Security number.`);
  }
  const isPublicPage = /^public\//.test(f) && !/^public\/admin\//.test(f);
  if (isPublicPage && /private_notes|privateNotes|visibility|retired/.test(text)) {
    failures.push(`${f} is a public page and mentions a private field.`);
  }
  if (/^public\/.*\.html$/.test(f)) {
    for (const m of text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const src = m[1];
      const allowed = src.startsWith('/') && !src.startsWith('//') || src.startsWith('https://challenges.cloudflare.com/turnstile/');
      if (!allowed) failures.push(`${f} loads an outside script: ${src}`);
    }
  }
}

// Every public page carries the same crisis bar (so no page can drift out of date).
const crisisOf = (f) => { const t = readFileSync(f, 'utf8'); const i = t.indexOf('<aside class="crisis"'); return i < 0 ? null : t.slice(i, t.indexOf('</aside>', i)); };
const crisis = crisisOf('public/index.html');
for (const f of tracked.filter((x) => /^public\/[^/]+\.html$/.test(x))) {
  if (crisisOf(f) !== crisis) failures.push(`${f} is missing the crisis bar, or it differs from public/index.html.`);
}
// ...and it is exactly the bar built from src/region.js, which the error
// pages (src/routes/error-pages.js) build with the same code.
{
  const { REGION } = await import('../src/region.js');
  const { crisisBarHtml } = await import('../src/lib/crisis-bar.js');
  if (!readFileSync('public/index.html', 'utf8').includes(crisisBarHtml(REGION))) {
    failures.push('public/index.html crisis bar differs from the one built from src/region.js. Run `npm run apply-region`.');
  }
}

// Hotline numbers written outside the crisis bar (the flyer's crisis box and
// the domestic violence search note) are not rewritten by apply-region: they
// must be the region's numbers, so a changed hotline can't stay wrong there.
{
  const { REGION } = await import('../src/region.js');
  const numbers = REGION.crisis.flatMap((g) => g.items.filter((i) => i.number && /\(\d{3}\)/.test(i.number)).map((i) => i.number));
  const flyer = readFileSync('public/flyer.html', 'utf8');
  const box = flyer.slice(flyer.indexOf('class="flyer-crisis"'));
  for (const n of numbers) if (!box.includes(n)) failures.push(`public/flyer.html crisis box is missing the hotline ${n} from src/region.js.`);
  const words = JSON.parse(readFileSync('public/content/words.json', 'utf8'));
  for (const e of words.entries.filter((x) => x.safety && (x.categories || []).includes('Domestic Violence'))) {
    for (const n of (e.note || '').match(/\(\d{3}\) \d{3}-\d{4}/g) || []) {
      if (!numbers.includes(n)) failures.push(`public/content/words.json domestic violence note has ${n}, which is not a hotline in src/region.js.`);
    }
    for (const n of numbers) if (!(e.note || '').includes(n)) failures.push(`public/content/words.json domestic violence note is missing the hotline ${n} from src/region.js.`);
  }
}

// The anonymous barrier form's checkboxes must match the server's fixed list.
{
  const { BARRIERS } = await import('../src/validate.js');
  const page = readFileSync('public/needs.html', 'utf8');
  const onPage = [...page.matchAll(/name="barriers" value="([a-z_]+)"/g)].map((m) => m[1]);
  const expected = BARRIERS.map(([id]) => id);
  if (onPage.join(',') !== expected.join(',')) failures.push('public/needs.html barrier checkboxes differ from BARRIERS in src/validate.js.');
}

// Local test mode must never be switched on in the uploaded settings.
if (/LOCAL_DEV_ADMIN/.test(readFileSync('wrangler.jsonc', 'utf8'))) {
  failures.push('wrangler.jsonc mentions LOCAL_DEV_ADMIN. Local test mode belongs only in .dev.vars.');
}

if (failures.length) {
  console.error('Privacy check FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Privacy check passed (${textFiles.length} files checked${adminEmail ? ', owner email not found in any' : ''}).`);
