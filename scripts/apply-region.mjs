// Apply src/region.js to the public pages: the red crisis bar, the site name
// and tagline, the help line ("call 211…"), page title endings, and the
// settings the page scripts read from <body data-…>.
//   npm run apply-region
// Safe to run any time; it only rewrites the marked parts of each page.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { REGION } from '../src/region.js';
// The crisis bar builder is shared with the error pages (src/routes/error-pages.js).
import { crisisBarHtml, escapeAttrText as esc } from '../src/lib/crisis-bar.js';

const f = REGION.fallback;
const fallbackText = `call ${f.phone} or search ${f.webLabel}`;
const fallbackLinks = `Call <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a> or search <a href="${esc(f.webUrl)}">${esc(f.webLabel)}</a>`;
const values = {
  siteName: esc(REGION.siteName),
  tagline: esc(REGION.tagline),
  fallbackText: esc(fallbackText),
  fallbackLinks,
  // The county dropdown on the anonymous "what's getting in your way" form
  // (public/needs.html). The last choice must match BARRIER_COUNTIES in src/validate.js.
  barrierCounties: ['\n            <option value="">Choose…</option>', ...REGION.counties.map((c) => `<option>${esc(c)}</option>`), '<option>Other or prefer not to say</option>']
    .join('\n            ') + '\n          ',
};
const body = `<body data-site-name="${esc(REGION.siteName)}" data-domain="${esc(REGION.domain)}" data-fallback="${esc(fallbackText)}">`;

let changed = 0;
for (const dir of ['public', 'public/admin']) {
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    const path = `${dir}/${name}`;
    const before = readFileSync(path, 'utf8');
    let s = before;
    s = s.replace(/<aside class="crisis"[\s\S]*?<\/aside>/, crisisBarHtml(REGION));
    s = s.replace(/(<(\w+)[^>]*\sdata-region="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => (key in values ? open + values[key] + close : m));
    if (dir === 'public') s = s.replace(/<body[^>]*>/, body);
    s = s.replace(/<title>(.*?): [^<]*<\/title>/, (m, page) => `<title>${page}: ${esc(REGION.siteName)}</title>`);
    if (s !== before) { writeFileSync(path, s); changed++; }
  }
}
// The installable-app settings (name shown under the home-screen icon).
{
  const path = 'public/manifest.webmanifest';
  const before = readFileSync(path, 'utf8');
  const m = JSON.parse(before);
  m.name = REGION.siteName;
  m.short_name = REGION.shortName || REGION.siteName.slice(0, 12);
  const c = REGION.counties;
  m.description = `Free directory of local help in ${c.length > 1 ? `${c.slice(0, -1).join(', ')} and ${c[c.length - 1]}` : c[0]} Counties.`;
  const after = JSON.stringify(m, null, 2) + '\n';
  if (after !== before) { writeFileSync(path, after); changed++; }
}
console.log(`Region settings applied to ${changed} page(s).`);
