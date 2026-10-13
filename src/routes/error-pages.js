// Friendly error pages (404, 403, 500) for page addresses: a small complete
// page with the crisis bar, the site name, a short message, a way back to the
// directory and the 211 help line. Built from src/region.js like the pause
// page, plain HTML, never cached and never indexed. Nothing from the request
// is written into the page. API addresses (/api/...) answer JSON instead
// (see src/http.js).

import { REGION } from '../region.js';
import { crisisBarHtml, escapeAttrText as esc } from '../lib/crisis-bar.js';

const KINDS = {
  404: { title: 'Page not found', text: 'That page doesn\'t exist or has moved.', statusText: 'Not Found' },
  403: { title: 'Not available', text: 'This page is only for the site\'s owner.', statusText: 'Forbidden' },
  500: { title: 'Something went wrong', text: 'Please try again in a minute.', statusText: 'Internal Server Error' },
};

/** A complete HTML error page. `kind` is the status: 404, 403 or 500. */
export function errorPage(kind) {
  const k = KINDS[kind] || KINDS[500];
  const status = KINDS[kind] ? Number(kind) : 500;
  const f = REGION.fallback;
  // The crisis bar is the exact markup every public page carries, and the
  // header is the same pale band with the site name, so the page looks like
  // the rest of the site without any CSS of its own.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(k.title)}: ${esc(REGION.siteName)}</title>
  <link rel="stylesheet" href="/css/site.css">
</head>
<body>
  ${crisisBarHtml(REGION)}
  <header class="site-header">
    <div class="header-row">
      <div>
        <p class="site-name"><a href="/">${esc(REGION.siteName)}</a></p>
      </div>
    </div>
  </header>
  <main id="main" class="paused-page">
    <h1>${esc(k.title)}</h1>
    <p>${esc(k.text)}</p>
    <p><a class="request-button" href="/"><strong>Go to the directory</strong></a></p>
    <aside class="fallback" aria-label="More help">
      <p><strong>Can't find it?</strong> Call <a href="tel:${esc(f.phone)}">${esc(f.phone)}</a> or search <a href="${esc(f.webUrl)}">${esc(f.webLabel)}</a>.</p>
    </aside>
  </main>
</body>
</html>`;
  return new Response(html, {
    status,
    statusText: k.statusText,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
