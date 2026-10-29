// Worker entry point: routes every request.
//
// - /admin/* and /api/admin/*: owner only, always (rule 3).
// - Everything else: public once SITE_PUBLIC is "true" (Phase 6). Until then
//   the whole site is owner only.
// - Public data comes only from src/db/public.js (rule 4).

import { getAdmin } from './auth.js';
import { getPublicDirectory } from './db/public.js';
import { handleAdminApi } from './routes/admin-api.js';
import { handleProviderRequest } from './routes/provider-form.js';
import { handleBarrierReport, barrierSummary } from './routes/barriers.js';
import { handleListingReport } from './routes/listing-reports.js';
import { withSecurityHeaders, json, notAvailable, notFound, serverError, isSameOrigin, weakEtag, etagMatches } from './http.js';
import { decoratePage, sitemap, robots } from './routes/pages.js';
import { emailWeeklyBackup } from './backup.js';
import { isPaused } from './db/notice.js';
import { pausedPage } from './routes/paused.js';
import { errorPage } from './routes/error-pages.js';

function isAdminPath(path) {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
}

async function route(request, env, url, admin) {
  const path = url.pathname;
  const method = request.method;

  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(request)) {
    return json({ error: 'Not allowed.' }, 403);
  }

  if (path.startsWith('/api/admin/')) return handleAdminApi(request, env, url, admin);

  // Emergency pause: every public address shows only the crisis numbers and
  // 211; forms take nothing. The admin panel (above and isAdminPath) still works.
  // The pause page's own style and cleanup script always load.
  const pauseExempt = path === '/robots.txt' || path === '/css/site.css' || path === '/js/paused.js';
  if (!isAdminPath(path) && !pauseExempt && (await isPaused(env))) {
    if (path.startsWith('/api/')) return json({ error: 'The directory is paused for now. Call 211 for help finding services.', paused: true }, 503, { 'Cache-Control': 'no-store', 'X-Site-Paused': '1' });
    if (method !== 'GET' && method !== 'HEAD') return errorPage(405);
    return pausedPage();
  }

  if (path === '/api/listings') {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Not allowed.' }, 405);
    // Kept for 60 seconds at Cloudflare, so a busy day reads the database
    // about once a minute instead of on every visit (the free plan allows
    // 5 million row reads a day). Admin edits show publicly within a minute.
    const cache = typeof caches !== 'undefined' && env.SITE_PUBLIC === 'true' && env.PUBLIC_CACHE !== 'off' ? caches.default : null;
    const key = new Request(new URL('/api/listings', url).toString());
    // Browsers are told to check every time ("no-cache"): Cloudflare would
    // otherwise stretch a short browser time to 4 hours. Only Cloudflare's
    // own copy is kept, for 60 seconds. Each copy carries a fingerprint
    // (ETag); a browser that sends it back and already has this exact copy
    // gets a tiny "not changed" (304) reply instead of the whole list again.
    const forBrowser = (r) => {
      const etag = r.headers.get('ETag');
      if (etagMatches(request.headers.get('If-None-Match'), etag)) {
        return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
      }
      const out = new Response(r.body, r);
      out.headers.set('Cache-Control', 'no-cache');
      return out;
    };
    const hit = cache ? await cache.match(key) : null;
    if (hit) return forBrowser(hit);
    const body = JSON.stringify(await getPublicDirectory(env.DB));
    const res = new Response(body, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ETag: await weakEtag(body) },
    });
    if (cache) await cache.put(key, res.clone());
    return forBrowser(res);
  }

  if (path === '/api/requests') {
    if (method !== 'POST') return json({ error: 'Not allowed.' }, 405);
    return handleProviderRequest(request, env, url);
  }

  if (path === '/api/listing-reports') {
    if (method !== 'POST') return json({ error: 'Not allowed.' }, 405);
    return handleListingReport(request, env, url);
  }

  if (path === '/api/barriers') {
    if (method !== 'POST') return json({ error: 'Not allowed.' }, 405);
    return handleBarrierReport(request, env, url);
  }

  // The "Don't see the help you need?" form was removed (owner decision,
  // 2026-10-12). Old links go to the directory; the form address takes nothing.
  if (path === '/api/suggestions') return json({ error: 'This form has been removed.' }, 410);
  if (path === '/suggest') return Response.redirect(new URL('/', url).toString(), 302);

  if (path === '/api/barriers/summary') {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Not allowed.' }, 405);
    // Cached for an hour so heavy traffic can't use up the database's daily reads.
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const key = new Request(new URL('/api/barriers/summary', url).toString());
    const hit = cache && env.SITE_PUBLIC === 'true' ? await cache.match(key) : null;
    if (hit) return hit;
    const res = json(await barrierSummary(env.DB));
    res.headers.set('Cache-Control', 'public, max-age=3600');
    if (cache && env.SITE_PUBLIC === 'true') await cache.put(key, res.clone());
    return res;
  }

  if (path.startsWith('/api/')) return notFound(path);

  // A page form sent without its script lands here: say plainly it wasn't sent.
  if (method !== 'GET' && method !== 'HEAD') return errorPage(405);

  if (path === '/sitemap.xml') {
    // Kept at Cloudflare for a minute once public (like /api/listings), so
    // crawlers don't read every listing row on each visit, and a retired or
    // Internal listing leaves the sitemap within a minute.
    const cache = typeof caches !== 'undefined' && env.SITE_PUBLIC === 'true' && env.PUBLIC_CACHE !== 'off' ? caches.default : null;
    const key = new Request(new URL('/sitemap.xml', url).toString());
    const hit = cache ? await cache.match(key) : null;
    if (hit) return hit;
    const res = await sitemap(env, url);
    if (cache) await cache.put(key, res.clone());
    return res;
  }
  if (path === '/robots.txt') return robots(url);

  // Pages are always fetched whole (no "not changed" replies), so the notice
  // and listing titles added below are never stale in a visitor's browser.
  if (!/\.[a-z0-9]+$/i.test(path) || path.endsWith('.html')) {
    const h = new Headers(request.headers);
    h.delete('If-None-Match');
    h.delete('If-Modified-Since');
    request = new Request(request, { headers: h });
  }

  let res;
  if (/^\/listing\/[a-z0-9-]{1,80}$/.test(path)) {
    // Each listing has its own link, served by the directory page.
    res = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  } else if (path === '/request' || path === '/needs' || path === '/about' || path === '/terms') {
    // Pages with a form get the Turnstile site key, and the support address is filled in.
    const page = await env.ASSETS.fetch(request);
    const support = env.SUPPORT_EMAIL || '';
    res = new HTMLRewriter()
      .on('.cf-turnstile', { element: (e) => e.setAttribute('data-sitekey', env.TURNSTILE_SITE_KEY || '') })
      .on('.support-email', { element: (e) => { if (support) { e.setAttribute('href', `mailto:${support}`); e.setInnerContent(support); } } })
      .on('.support-line', { element: (e) => { if (support) e.removeAttribute('hidden'); } })
      .transform(page);
  } else {
    res = await env.ASSETS.fetch(request);
    if (res.status === 404) return notFound(path);
  }
  // Public pages: link previews, listing titles and the site notice.
  const isPage = (res.headers.get('Content-Type') || '').startsWith('text/html') && res.status === 200;
  return isPage && !isAdminPath(path) ? decoratePage(res, env, url) : res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const sitePublic = env.SITE_PUBLIC === 'true';
    const ownerOnly = isAdminPath(path) || !sitePublic;

    let response;
    try {
      const admin = ownerOnly ? await getAdmin(request, env) : null;
      response = ownerOnly && !admin ? notAvailable(path) : await route(request, env, url, admin);
    } catch (err) {
      // Log the error type only, never request contents (rule 1).
      console.error('Unhandled error:', err?.name, err?.message);
      response = serverError(path);
    }
    return withSecurityHeaders(response, { privateResponse: ownerOnly });
  },

  // Weekly automatic backup, emailed to the owner (see src/backup.js).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(emailWeeklyBackup(env).catch((err) => console.error('Weekly backup failed:', err?.name, err?.message)));
  },
};
