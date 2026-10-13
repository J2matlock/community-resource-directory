// Offline copy of the PUBLIC directory, so it still opens and searches with a
// weak or no signal. Rules:
// - Only same-origin GET requests for public pages, scripts, styles, images,
//   the public listings data and the content files are ever stored.
// - Never the admin panel, admin data, or anything sent with a form (rule 4).
// - Fresh copies come first (network first); the saved copy is only used when
//   the network fails, and the page says so.

const VERSION = 'sadk-v6';
const SHELL = [
  '/', '/learn', '/help', '/about', '/terms', '/needs', '/request',
  '/css/site.css', '/js/nav.js', '/js/directory.js', '/js/search.js', '/js/safety.js', '/js/learn.js', '/js/help.js', '/js/qr.js',
  '/content/learn.json', '/content/help.json', '/content/needs.json', '/content/words.json',
  '/api/listings', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png',
];

function isCacheable(url, request) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin') || p.startsWith('/cdn-cgi/')) return false;
  if (p.startsWith('/api/') && p !== '/api/listings' && p !== '/api/barriers/summary') return false;
  return true;
}

// Stamp each saved copy with the time it was saved, so the page can say how old it is.
async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Saved-At', new Date().toISOString());
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One by one, so a single failure doesn't stop the rest.
    await Promise.all(SHELL.map(async (path) => {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (res.ok && !(res.headers.get('Cache-Control') || '').includes('no-store')) await cache.put(path, await stamped(res));
      } catch { /* offline during install: try again next time */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isCacheable(url, request)) return; // the browser handles it normally
  // Listing links are all served by the directory page: offline, use its copy.
  const isListing = /^\/listing\/[a-z0-9-]+$/.test(url.pathname);
  const key = url.pathname;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(request);
      if (!isListing && res.ok && res.type === 'basic' && !(res.headers.get('Cache-Control') || '').includes('no-store')) {
        cache.put(key, await stamped(res.clone()));
      }
      return res;
    } catch {
      const saved = (isListing ? null : await cache.match(key)) || (request.mode === 'navigate' ? await cache.match('/') : null);
      if (!saved) return Response.error();
      const headers = new Headers(saved.headers);
      headers.set('X-From-Offline-Copy', '1');
      let body = saved.body;
      // A saved page may hold an old notice ("Code Blue open tonight"): drop it.
      if ((saved.headers.get('Content-Type') || '').includes('text/html')) {
        body = (await saved.text()).replace(/<div class="site-notice[^"]*"[^>]*>[\s\S]*?<\/div>/, '');
        headers.delete('Content-Length');
      }
      return new Response(body, { status: saved.status, statusText: saved.statusText, headers });
    }
  })());
});
