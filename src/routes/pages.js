// Public page extras, added on the way out (no client-side scripts needed):
// - link previews (Open Graph) and a canonical address on every public page;
// - each listing page gets its own title and description, so a shared link
//   or a search result shows the listing's name instead of the home page;
// - the owner's site notice, under the crisis bar;
// - sitemap.xml and robots.txt for search engines.
// Listing details come only from src/db/public.js (rule 4), and every value
// written into a page is escaped as text (rule 5).

import { REGION } from '../region.js';
import { getPublicListing, getPublicListingIds } from '../db/public.js';
import { getActiveNotice } from '../db/notice.js';
import { todayLocal } from '../db/admin.js';
import { neutralId } from '../lib/neutral-id.js';
import { DV_CATEGORY } from '../lib/site-names.js';

// Categories whose listings get neutral titles and link previews.
export const SENSITIVE_CATEGORIES = [DV_CATEGORY];

// Neutral address ("h-…") → real id for sensitive listings. Kept for a minute
// per running copy of the Worker, so a DV listing link doesn't read every
// public row on each view.
let neutralMemo = { map: null, at: 0 };
/** Forget the remembered addresses (tests). */
export function forgetNeutralMemo() { neutralMemo = { map: null, at: 0 }; }
async function realIdFor(db, neutral) {
  const age = Date.now() - neutralMemo.at;
  // Re-read after a minute, or after 5 seconds when the address isn't known
  // (a DV listing published a moment ago works almost at once).
  if (!neutralMemo.map || age >= 60_000 || (!neutralMemo.map.has(neutral) && age >= 5_000)) {
    const rows = await getPublicListingIds(db);
    neutralMemo = { map: new Map(rows.filter((r) => SENSITIVE_CATEGORIES.includes(r.category)).map((r) => [neutralId(r.id), r.id])), at: Date.now() };
  }
  return neutralMemo.map.get(neutral) ?? null;
}

const STATIC_PAGES = ['/', '/learn', '/needs', '/help', '/about', '/terms', '/request', '/flyer'];

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Text taken from the page itself is already written as HTML (&amp; etc.):
// turn it back into plain text before it is escaped again.
function decodeEntities(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e]);
}

function shorten(text, max = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

function listingDescription(l) {
  const where = [l.category, l.town].filter(Boolean).join(' in ');
  const phone = l.phone ? ` Call ${l.phone}.` : '';
  return shorten(`${where ? `${where}. ` : ''}${l.description || l.eligibility || ''}`.trim(), 170) + phone;
}

function metaTags({ title, description, url, image, noindex }) {
  const tags = [
    ['og:type', 'website'], ['og:site_name', REGION.siteName], ['og:title', title], ['og:description', description],
    ['og:url', url], ['og:image', image], ['og:image:width', '1200'], ['og:image:height', '630'],
    ['og:image:alt', `${REGION.siteName}: free help in ${REGION.counties.join(', ')} Counties`],
  ].map(([p, v]) => `<meta property="${p}" content="${escapeHtml(v)}">`);
  tags.push('<meta name="twitter:card" content="summary_large_image">');
  tags.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  tags.push('<link rel="manifest" href="/manifest.webmanifest">');
  tags.push('<meta name="theme-color" content="#1d3f29">');
  tags.push('<link rel="apple-touch-icon" href="/icons/icon-192.png">');
  if (noindex) tags.push('<meta name="robots" content="noindex">');
  return `\n  ${tags.join('\n  ')}\n`;
}

// JSON inside a non-running script tag; "<" is escaped so the text can never
// close the tag early (rule 5).
function listingDataHtml(l) {
  const json = JSON.stringify(l).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script type="application/json" id="listing-data">${json}</script>`;
}

function noticeHtml(n) {
  const cls = n.level === 'urgent' ? 'site-notice urgent' : 'site-notice';
  const label = n.level === 'urgent' ? 'Important notice' : 'Notice';
  return `<div class="${cls}" role="region" aria-label="${label}"><p><strong>${label}:</strong> ${escapeHtml(n.message)}</p></div>`;
}

// Adds the extras to a public HTML page. `path` is the page's own address.
export async function decoratePage(response, env, url) {
  const path = url.pathname;
  const listingId = (path.match(/^\/listing\/([a-z0-9-]{1,80})$/) || [])[1];
  let notice = null;
  let listing = null;
  try {
    // A neutral address ("h-…") belongs to a sensitive listing: find which.
    let realId = listingId;
    if (listingId && listingId.startsWith('h-')) realId = await realIdFor(env.DB, listingId);
    [notice, listing] = await Promise.all([
      getActiveNotice(env.DB, todayLocal()),
      realId ? getPublicListing(env.DB, realId) : null,
    ]);
  } catch (err) {
    // A database hiccup must never take down the pages (or the crisis bar).
    // The page still gets the Turnstile key, so "Did something not work?" stays.
    console.error('Page extras skipped:', err?.name);
    return new HTMLRewriter()
      .on('#turnstile-key', { element: (e) => e.setAttribute('data-sitekey', env.TURNSTILE_SITE_KEY || '') })
      .transform(response);
  }
  const origin = url.origin;
  const image = `${origin}/og-image.png`;
  let title = '';
  let description = '';
  const rw = new HTMLRewriter();
  // The "Did something not work?" buttons need the Turnstile site key.
  rw.on('#turnstile-key', { element: (e) => e.setAttribute('data-sitekey', env.TURNSTILE_SITE_KEY || '') });
  if (listingId) {
    // Domestic violence listings get a neutral title and preview: a shared
    // link's preview, and the browser history, may be seen by an abuser.
    const sensitive = listing && SENSITIVE_CATEGORIES.includes(listing.category);
    title = !listing ? `Listing not found: ${REGION.siteName}` : sensitive ? `Local help: ${REGION.siteName}` : `${listing.name}: ${REGION.siteName}`;
    description = !listing ? '' : sensitive ? 'Free local help. Open the link for the phone number and details.' : listingDescription(listing);
    rw.on('title', { element: (e) => e.setInnerContent(title) });
    if (listing) rw.on('meta[name="description"]', { element: (e) => e.setAttribute('content', description) });
  } else {
    rw.on('title', { text: (t) => { title += decodeEntities(t.text); } });
  }
  rw.on('meta[name="description"]', { element: (e) => { if (!description) description = decodeEntities(e.getAttribute('content') || ''); } });
  rw.on('head', {
    element: (e) => e.onEndTag((end) => {
      const pagePath = listing && SENSITIVE_CATEGORIES.includes(listing.category) ? `/listing/${neutralId(listing.id)}` : path;
      end.before(metaTags({ title: title.trim(), description, url: `${origin}${pagePath}`, image, noindex: listingId && !listing }), { html: true });
    }),
  });
  if (notice) rw.on('aside.crisis', { element: (e) => e.after(noticeHtml(notice), { html: true }) });
  // The listing itself (public columns only, rule 4) rides along with its own
  // page, so a texted link shows the card at once instead of waiting for the
  // whole directory on a weak signal. Not for sensitive listings: their page
  // carries only neutral text.
  if (listing && !SENSITIVE_CATEGORIES.includes(listing.category)) {
    rw.on('body', { element: (e) => e.append(listingDataHtml(listing), { html: true }) });
  }
  const out = rw.transform(response);
  const headers = new Headers(out.headers);
  headers.delete('ETag');
  headers.delete('Last-Modified');
  headers.set('Cache-Control', 'no-cache');
  // A listing link that goes nowhere (unknown, hidden or retired) answers 404:
  // the page still shows "not found", but search engines and the offline
  // copy on a visitor's phone don't keep it.
  const missing = Boolean(listingId) && !listing;
  return new Response(out.body, { status: missing ? 404 : out.status, statusText: missing ? 'Not Found' : out.statusText, headers });
}

export async function sitemap(env, url) {
  const ids = await getPublicListingIds(env.DB);
  const loc = (p) => `  <url><loc>${escapeHtml(`${url.origin}${p}`)}</loc></url>`;
  const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_PAGES.map(loc),
    ...ids.map((r) => loc(`/listing/${SENSITIVE_CATEGORIES.includes(r.category) ? neutralId(r.id) : r.id}`)),
    '</urlset>', ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}

export function robots(url) {
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /request-thanks', '',
    `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
