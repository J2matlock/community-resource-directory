// Apply src/region.js to the public pages: the red crisis bar, the site name
// and tagline, the help line ("call 211…"), page title endings, and the
// settings the page scripts read from <body data-…>.
//   npm run apply-region
// Safe to run any time; it only rewrites the marked parts of each page.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { REGION } from '../src/region.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function crisisBar() {
  const groups = REGION.crisis.map((g) => {
    const items = g.items.map((it) => {
      const cls = it.wide ? (it.note ? ' class="wide-only crisis-note"' : ' class="wide-only"') : '';
      if (it.note) return `        <li${cls}>${esc(it.note)}</li>`;
      const sr = it.srPrefix ? `<span class="visually-hidden">${esc(it.srPrefix)}</span>` : '';
      return `        <li${cls}><a href="${esc(it.href)}">${sr}<strong>${esc(it.number)}</strong> ${esc(it.label)}</a></li>`;
    }).join('\n');
    const phoneCount = g.items.filter((it) => !it.wide).length;
    const layout = phoneCount >= 3 ? 'three' : 'two';
    return `    <div class="crisis-group">
      <p class="crisis-title">${esc(g.title)}</p>
      <ul class="crisis-list ${layout}">
${items}
      </ul>
    </div>`;
  }).join('\n');
  return `<aside class="crisis" aria-label="Crisis help">\n${groups}\n  </aside>`;
}

const f = REGION.fallback;
const fallbackText = `call ${f.phone} or search ${f.webLabel}`;
const fallbackLinks = `Call <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a> or search <a href="${esc(f.webUrl)}">${esc(f.webLabel)}</a>`;
const values = {
  siteName: esc(REGION.siteName),
  tagline: esc(REGION.tagline),
  fallbackText: esc(fallbackText),
  fallbackLinks,
  // The optional county question on the "Don't see the help you need?" form.
  countyOptions: ['\n            <option value="">Prefer not to say</option>', ...REGION.counties.map((c) => `<option>${esc(c)}</option>`), '<option>Somewhere else</option>']
    .join('\n            ') + '\n          ',
};
const body = `<body data-site-name="${esc(REGION.siteName)}" data-domain="${esc(REGION.domain)}" data-fallback="${esc(fallbackText)}">`;

let changed = 0;
for (const dir of ['public', 'public/admin']) {
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    const path = `${dir}/${name}`;
    const before = readFileSync(path, 'utf8');
    let s = before;
    s = s.replace(/<aside class="crisis"[\s\S]*?<\/aside>/, crisisBar());
    s = s.replace(/(<(\w+)[^>]*\sdata-region="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => (key in values ? open + values[key] + close : m));
    if (dir === 'public') s = s.replace(/<body[^>]*>/, body);
    s = s.replace(/<title>(.*?): [^<]*<\/title>/, (m, page) => `<title>${page}: ${esc(REGION.siteName)}</title>`);
    if (s !== before) { writeFileSync(path, s); changed++; }
  }
}
console.log(`Region settings applied to ${changed} page(s).`);
