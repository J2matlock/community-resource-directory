// The page every public address shows while the site is paused: the crisis
// numbers and the 211 help line only. Built from src/region.js, plain HTML,
// never cached, and it clears any offline copy on the visitor's device so an
// old saved directory doesn't keep showing.

import { REGION } from '../region.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pausedPage() {
  const groups = REGION.crisis.map((g) => `
      <h2>${esc(g.title)}</h2>
      <ul class="paused-list">${g.items.filter((i) => i.href).map((i) => `
        <li><a href="${esc(i.href)}">${i.srPrefix ? `<span class="visually-hidden">${esc(i.srPrefix)}</span>` : ''}<strong>${esc(i.number)}</strong> ${esc(i.label)}</a></li>`).join('')}
      </ul>${g.items.filter((i) => i.note).map((i) => `
      <p class="paused-note">${esc(i.note)}</p>`).join('')}`).join('');
  const f = REGION.fallback;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(REGION.siteName)} is paused</title>
  <link rel="stylesheet" href="/css/site.css">
  <script defer src="/js/paused.js"></script>
</head>
<body>
  <main id="main" class="paused-page">
    <h1>${esc(REGION.siteName)} is paused for now</h1>
    <p>The directory is offline for a short time. For help finding services, call <a href="tel:${esc(f.phone)}"><strong>${esc(f.phone)}</strong></a> (24 hours) or search <a href="${esc(f.webUrl)}">${esc(f.webLabel)}</a>.</p>
    ${groups}
    <p>In an emergency, call 911.</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
