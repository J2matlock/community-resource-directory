// Offline copy of the PUBLIC directory, so it still opens and searches with a
// weak or no signal. Rules:
// - Only same-origin GET requests for public pages, scripts, styles, images,
//   the public listings data and the content files are ever stored.
// - Never the admin panel, admin data, or anything sent with a form (rule 4).
// - Fresh copies come first. The saved copy is used when the network fails,
//   when the server has a fault (500, 502, 504; never the 503 "paused" reply),
//   or when a reply stalls (no answer, or no new data, for a few seconds) and
//   a saved copy exists. The page says so. The fresh copy keeps coming in the
//   background and is saved for next time.
// - The owner's emergency pause always wins: any reply marked X-Site-Paused
//   (even one that arrives after a saved copy was shown) deletes the saved
//   copy, removes this worker and reloads open pages, so the pause shows.
// - First visit: only the directory itself is saved, after the page has
//   loaded (nav.js waits), re-using what the browser already downloaded.
//   Other pages and their scripts are saved when someone opens them.

const VERSION = 'sadk-v7';
const CORE = [
  '/', '/css/site.css', '/js/nav.js', '/js/directory.js', '/js/search.js', '/js/safety.js',
  '/content/words.json', '/api/listings', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png',
];
// How long a reply may stall (no answer, or no new data) before the saved copy
// is used. Once one reply has stalled, the connection is known to be poor, so
// the rest of that page load waits less.
const STALL_MS = 4000;
const STALL_MS_POOR = 1000;
let lastStallAt = 0;
function stallLimit() { return Date.now() - lastStallAt < 30000 ? STALL_MS_POOR : STALL_MS; }

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

function storable(res) {
  return res.ok && res.type === 'basic' && !(res.headers.get('Cache-Control') || '').includes('no-store');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One by one, so a single failure doesn't stop the rest. "no-cache" asks
    // the server whether the browser's copy is still current, so files the
    // page just downloaded aren't downloaded a second time.
    await Promise.all(CORE.map(async (path) => {
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (storable(res)) await cache.put(path, await stamped(res));
      } catch { /* offline during install: try again next time */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Pages and files saved by an older version are carried over (unless this
    // version already has them), so an upgrade, or a save that failed on a weak
    // signal, never leaves a phone with less offline than before.
    const cache = await caches.open(VERSION);
    for (const key of await caches.keys()) {
      if (key === VERSION) continue;
      if (key.startsWith('sadk-')) {
        const old = await caches.open(key);
        for (const req of await old.keys()) {
          if (new URL(req.url).pathname.startsWith('/listing/')) continue; // never kept
          if (!(await cache.match(req))) await cache.put(req, await old.match(req));
        }
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The site is paused: forget everything and show the pause on every open page.
async function goPaused() {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
}

// The saved copy, marked so the page can say it is not fresh. A saved page
// may hold an old notice ("Code Blue open tonight"): it is dropped.
async function fromSaved(saved) {
  const headers = new Headers(saved.headers);
  headers.set('X-From-Offline-Copy', '1');
  let body = saved.body;
  if ((saved.headers.get('Content-Type') || '').includes('text/html')) {
    body = (await saved.text()).replace(/<div class="site-notice[^"]*"[^>]*>[\s\S]*?<\/div>/, '');
    headers.delete('Content-Length');
  }
  return new Response(body, { status: saved.status, statusText: saved.statusText, headers });
}

// A server fault the saved copy can stand in for. 503 is the owner's
// emergency pause (or a deliberate "unavailable"), which must always show.
function serverFault(res) {
  return res.status >= 500 && res.status !== 503;
}

// Reads a reply to the end, giving up if no new data arrives for `limit` ms.
// Resolves with the whole body, or rejects with "stall". The read keeps going
// after a stall, and `done` finishes with the body for saving.
function readGuarded(res, limit) {
  let finish;
  const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  let timer;
  const guard = new Promise((_, reject) => {
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => reject(new Error('stall')), limit); };
    arm();
    (async () => {
      try {
        if (!res.body) { clearTimeout(timer); finish.resolve(new Uint8Array(0)); return; }
        const reader = res.body.getReader();
        const parts = [];
        let size = 0;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          parts.push(value);
          size += value.byteLength;
          arm();
        }
        clearTimeout(timer);
        const all = new Uint8Array(size);
        let at = 0;
        for (const part of parts) { all.set(part, at); at += part.byteLength; }
        finish.resolve(all);
      } catch (err) {
        clearTimeout(timer);
        finish.reject(err);
      }
    })();
  });
  done.catch(() => {});
  return { body: Promise.race([done, guard]), done };
}

function withBody(res, body) {
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isCacheable(url, request)) return; // the browser handles it normally
  // Listing links are all served by the directory page: offline, use its copy.
  const isListing = /^\/listing\/[a-z0-9-]+$/.test(url.pathname);
  const key = url.pathname;
  const navigate = request.mode === 'navigate';

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const saved = (isListing ? null : await cache.match(key)) || (navigate && isListing ? await cache.match('/') : null);
    const save = (res, body) => {
      if (!isListing && storable(res)) event.waitUntil(stamped(withBody(res, body)).then((r) => cache.put(key, r)).catch(() => {}));
    };
    const watchPause = (res) => {
      if (res.headers.get('X-Site-Paused') === '1') event.waitUntil(goPaused());
    };

    // Nothing saved: the network as it comes (nothing better to offer).
    if (!saved) {
      try {
        const res = await fetch(request);
        watchPause(res);
        // Listing pages are never stored: the directory's copy stands in for
        // them, and a saved DV listing page would be a record of the visit.
        if (!isListing && storable(res)) event.waitUntil(stamped(res.clone()).then((r) => cache.put(key, r)).catch(() => {}));
        return res;
      } catch {
        // A page never opened on this phone: go to the saved directory, which
        // says it is offline, rather than a browser error page.
        if (navigate && (await cache.match('/'))) return Response.redirect('/#not-saved', 302);
        return Response.error();
      }
    }

    // A saved copy exists: the network gets a few seconds to answer and to
    // keep sending; if it stalls or fails, the saved copy is shown.
    const limit = stallLimit();
    const network = fetch(request);
    network.catch(() => {});
    let timer;
    try {
      const res = await Promise.race([network, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('stall')), limit); })]);
      clearTimeout(timer);
      watchPause(res);
      // Redirects and anything without a readable body go straight through.
      if (res.headers.get('X-Site-Paused') === '1' || res.type === 'opaqueredirect' || res.status === 0 || !res.body) return res;
      if (serverFault(res)) return fromSaved(saved);
      const { body, done } = readGuarded(res, limit);
      try {
        const all = await body;
        save(res, all);
        return withBody(res, all);
      } catch (err) {
        if (err.message !== 'stall') throw err;
        lastStallAt = Date.now();
        event.waitUntil(done.then((all) => save(res, all)).catch(() => {}));
        return fromSaved(saved);
      }
    } catch (err) {
      clearTimeout(timer);
      if (err && err.message === 'stall') {
        lastStallAt = Date.now();
        // Keep the fresh copy coming, and still notice a pause when it answers.
        event.waitUntil(network.then((res) => {
          watchPause(res);
          if (res.headers.get('X-Site-Paused') === '1' || serverFault(res)) return null;
          return readGuarded(res, 60000).done.then((all) => save(res, all));
        }).catch(() => {}));
      }
      return fromSaved(saved);
    }
  })());
});
