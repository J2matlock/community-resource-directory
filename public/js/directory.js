// Public directory: loads the public listings once, then searches and filters
// them in the browser. All listing text is inserted with textContent, never
// as HTML. Written for older phones too (no ?. ?? or replaceChildren).

(function () {
  'use strict';

  var PARAMS = { q: 'q', category: 'category', county: 'county', plan: 'plan', cost: 'cost', age: 'age' };
  var UNSPECIFIED_PLAN = 'Medicaid (call to check plan)';
  var PLAN_UNLISTED_LABEL = 'Medicaid, plan not listed (call to check)';
  var COST_LABELS = { 'Sliding scale': 'Sliding scale (price based on income)', 'Uninsured OK': 'OK without insurance' };
  var HANDOUT_KEY = 'handout-ids';
  // Site settings come from <body data-…> (set by `npm run apply-region`).
  var SITE = document.body.dataset || {};
  var SITE_NAME = SITE.siteName || 'Resource directory';
  var HELP_LINE = SITE.fallback || 'call 211';
  var FALLBACK = 'Sorry, the resources could not load. Please try again, or ' + HELP_LINE + '.';

  function $(id) { return document.getElementById(id); }
  var state = { q: '', category: '', county: '', plan: '', cost: '', age: '' };
  var data = null;
  var handout = loadHandout();
  var categoryButtons = {};
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 40rem)') : { matches: false };

  // ---------- small DOM helpers ----------
  function flatten(list, out) {
    out = out || [];
    for (var i = 0; i < list.length; i++) {
      if (Array.isArray(list[i])) flatten(list[i], out); else out.push(list[i]);
    }
    return out;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else if (k === 'checked') node.checked = Boolean(v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    flatten(Array.prototype.slice.call(arguments, 2)).forEach(function (c) {
      if (c === undefined || c === null || c === false || c === '') return;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function hidden(text) { return el('span', { class: 'visually-hidden' }, text); }

  function setChildren(node, children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    flatten(children).forEach(function (c) { if (c) node.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); });
  }

  // ---------- formatting ----------
  function telHref(phone) {
    if (/^\d{3}$/.test(phone)) return 'tel:' + phone;
    var m = phone.match(/^\((\d{3})\) (\d{3})-(\d{4})(?: x(\d+))?$/);
    if (!m) return null;
    return 'tel:+1' + m[1] + m[2] + m[3] + (m[4] ? ',' + m[4] : '');
  }

  function safeWebsite(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function websiteLabel(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  function mapsHref(address) {
    if (!address || /^p\.?\s*o\.?\s*box/i.test(address)) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // Two honest stamps: confirmed with the program itself, or checked online
  // against its own website or an official source.
  function checkedLine(l) {
    if (l.last_verified) return 'Confirmed with the program: ' + formatDate(l.last_verified);
    if (l.last_checked_online) return 'Checked online: ' + formatDate(l.last_checked_online);
    return 'Not yet checked';
  }

  // Where the listing's details come from: up to 3 links, one per line, each
  // with the month it was checked ("Info from: wahacaa.org (October 2026)").
  function sourcesBlock(l, single) {
    var srcs = (l.sources || []).filter(function (s) { return s && s.url && safeWebsite(s.url); });
    if (!srcs.length) return null;
    var hosts = srcs.map(function (s) { return websiteLabel(s.url); });
    var forWho = single ? ' (source for this listing)' : ' (source for ' + l.name + ')';
    var items = srcs.map(function (s, i) {
      var href = safeWebsite(s.url);
      var text = hosts[i];
      // Two sources on the same site: add the start of the page path so they differ.
      if (hosts.indexOf(text) !== hosts.lastIndexOf(text)) {
        try {
          var first = new URL(href).pathname.split('/').filter(Boolean)[0] || '';
          if (first) text += '/' + (first.length > 20 ? first.slice(0, 20) + '…' : first);
        } catch (e) { /* keep host */ }
      }
      var d = s.seen ? new Date(s.seen + 'T12:00:00') : null;
      var when = d && !isNaN(d.getTime()) ? ' (' + d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) + ')' : '';
      return el('li', {}, el('a', { href: href, rel: 'noopener noreferrer nofollow' }, text, hidden(forWho)), when);
    });
    return el('div', { class: 'card-sources' }, el('p', {}, 'Info from:'), el('ul', {}, items));
  }

  // One-tap "This didn't work" reports: anonymous and tap-only. The visitor
  // picks one of three reasons; Cloudflare's "are you human" check loads only
  // then. Reports go to the owner's re-check list and never change a listing.
  var REPORT_REASONS = [['phone', 'The phone number didn\u2019t work'], ['closed', 'Closed or moved'], ['full', 'Not taking new people']];
  var turnstileLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (turnstileLoading) return turnstileLoading;
    turnstileLoading = new Promise(function (resolve, reject) {
      window.sadkTurnstileReady = resolve;
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=sadkTurnstileReady';
      s.async = true;
      s.onerror = function () { turnstileLoading = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return turnstileLoading;
  }

  function reportBlock(l, who) {
    var keyEl = document.getElementById('turnstile-key');
    var sitekey = keyEl ? keyEl.getAttribute('data-sitekey') : '';
    if (!sitekey) return null;
    var status = el('p', { class: 'report-status', role: 'status', tabindex: '-1' });
    var hint = el('p', { class: 'note' }, 'Tap one. It\u2019s anonymous: we only learn which listing and which button.');
    var sending = false;
    var check = el('div', { class: 'report-check' });
    var buttons = el('div', { class: 'report-buttons' });
    var widgetId = null;
    // aria-disabled (not disabled) while sending, so keyboard focus stays on the button.
    function busy(on) {
      sending = on;
      Array.prototype.forEach.call(buttons.querySelectorAll('button'), function (b) { if (on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); });
    }
    function fail(msg) {
      status.textContent = msg + ' You can also use "Report a correction".';
      busy(false);
    }
    function send(reason) {
      if (sending) return;
      busy(true);
      status.textContent = 'Checking you\u2019re human\u2026 If a box appears, tick it.';
      loadTurnstile().then(function () {
        if (widgetId !== null) { try { window.turnstile.remove(widgetId); } catch (e) { /* already gone */ } }
        while (check.firstChild) check.removeChild(check.firstChild);
        widgetId = window.turnstile.render(check, {
          sitekey: sitekey, action: 'report', size: check.clientWidth < 300 ? 'compact' : 'flexible',
          callback: function (token) {
            status.textContent = 'Sending\u2026';
            fetch('/api/listing-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ listing_id: l.id, reason: reason, nickname: '', turnstile_token: token }) })
              .then(function (res) {
                if (res.ok) {
                  status.textContent = 'Thanks. We\u2019ll check this listing.';
                  status.focus();
                  while (buttons.firstChild) buttons.removeChild(buttons.firstChild);
                  while (check.firstChild) check.removeChild(check.firstChild);
                  hint.hidden = true;
                } else {
                  fail(res.status === 429 ? 'Too many reports right now. Please try again later.' : 'That didn\u2019t send.');
                }
              })
              .catch(function () { fail('That didn\u2019t send. Please check your connection.'); });
          },
          'error-callback': function () { fail('The \u201care you human\u201d check didn\u2019t work.'); },
          'expired-callback': function () { fail('The \u201care you human\u201d check ran out of time. Please tap again.'); },
          'timeout-callback': function () { fail('The \u201care you human\u201d check ran out of time. Please tap again.'); },
        });
      }).catch(function () { fail('The \u201care you human\u201d check didn\u2019t load.'); });
    }
    REPORT_REASONS.forEach(function (r) {
      buttons.appendChild(el('button', { type: 'button', class: 'secondary', onclick: function () { send(r[0]); } }, r[1], hidden(who)));
    });
    return el('details', { class: 'report-box' },
      el('summary', {}, 'Did something not work?', hidden(who)),
      hint, buttons, check, status);
  }

  // Domestic violence listings use a neutral address ("h-…") everywhere, so
  // browser history, shared links and QR codes don't name the program.
  // Same formula as src/lib/neutral-id.js.
  var DV = 'Domestic Violence';
  function neutralId(id) {
    var h = 0x811c9dc5;
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'h-' + h.toString(36);
  }
  function linkId(l) { return l.category === DV ? neutralId(l.id) : l.id; }
  function findListing(idOrAlias) {
    return data.listings.filter(function (x) { return x.id === idOrAlias || (x.category === DV && neutralId(x.id) === idOrAlias); })[0];
  }
  function listingUrl(l) { return location.origin + '/listing/' + linkId(l); }

  // Plain characters only, so a text message stays in the cheap 160-character
  // mode and shows correctly on flip phones (curly quotes and dashes force a
  // long, split message and can show up as boxes).
  function plainText(s) {
    return String(s)
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[\u00A0\u2007\u202F]/g, ' ')
      .replace(/\u00B7/g, '-')
      .replace(/[^\x00-\x7E\n]/g, '');
  }

  // What the Text button sends: short and plain. Domestic violence listings
  // send only the number and hours, with no program name, because someone
  // else may read the person's messages.
  function textMessage(l) {
    if (l.category === 'Domestic Violence') {
      var safe = ['Number to call: ' + (l.phone || '211')];
      if (l.hours) safe.push('Hours: ' + l.hours);
      return plainText(safe.join('\n'));
    }
    var lines = [l.name];
    if (l.phone) lines.push(l.phone);
    if (l.address) lines.push(l.address);
    if (l.hours) lines.push(l.hours);
    if (l.website) lines.push(l.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
    return plainText(lines.join('\n'));
  }

  function shareText(l) {
    var lines = [l.name];
    if (l.status !== 'Active') lines.push('(' + l.status + ')');
    if (l.phone) lines.push('Phone: ' + l.phone);
    if (l.address) lines.push('Address: ' + l.address);
    if (l.hours) lines.push('Hours: ' + l.hours);
    if (l.website) lines.push(l.website);
    return lines.join('\n');
  }

  // ---------- offline copy ----------
  function showOfflineNote(savedAt) {
    var d = savedAt ? new Date(savedAt) : null;
    var when = d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'earlier';
    var note = $('offline-note');
    // Sent here from a page that was never saved on this phone (see /sw.js).
    var notSaved = location.hash === '#not-saved';
    if (notSaved) history.replaceState(null, '', location.pathname + location.search);
    note.textContent = (notSaved ? 'That page isn\'t saved on this phone yet, so here is the directory. ' : '')
      + (navigator.onLine === false ? 'You\'re offline' : 'No signal or a slow connection') + ', so this is the copy saved on this device on ' + when + '. Calls and texts still work; details may have changed.';
    note.hidden = false;
  }

  // ---------- URL state ----------
  function readUrl() {
    var p = new URLSearchParams(location.search);
    Object.keys(PARAMS).forEach(function (key) { state[key] = p.get(PARAMS[key]) || ''; });
  }

  function writeUrl() {
    var p = new URLSearchParams();
    var sensitive = isSensitive();
    Object.keys(PARAMS).forEach(function (key) {
      if (sensitive && (key === 'q' || key === 'category')) return;
      if (state[key]) p.set(PARAMS[key], state[key]);
    });
    var qs = p.toString();
    var url = '/' + (qs ? '?' + qs : '');
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
    rememberList(url);
  }

  function rememberFromList() {
    try { sessionStorage.setItem('from-list', location.pathname + location.search); } catch (e) { /* private mode */ }
  }

  // "← Back to your results" on a listing goes to the search the visitor came
  // from (this tab only), or to all resources.
  var LAST_LIST_KEY = 'last-list';
  function rememberList(url) {
    try { sessionStorage.setItem(LAST_LIST_KEY, url); } catch (e) { /* private mode */ }
  }
  function showBackLink() {
    var last = '';
    try { last = sessionStorage.getItem(LAST_LIST_KEY) || ''; } catch (e) { /* private mode */ }
    var a = $('back-link').querySelector('a');
    var useLast = /^\/\?[^/]*$/.test(last);
    a.setAttribute('href', useLast ? last : '/');
    a.textContent = useLast ? '← Back to your results' : '← All resources';
    $('back-link').hidden = false;
    // Came straight from those results in this tab: go Back, which returns to
    // the same place in the list (a new visit would start at the top).
    a.onclick = function (e) {
      var from = '';
      try { from = sessionStorage.getItem('from-list') || ''; } catch (err) { /* private mode */ }
      if (useLast && from === last && history.length > 1) { e.preventDefault(); history.back(); }
    };
  }

  // A shared list: /?list=id1,id2 shows just those listings, in that order.
  function sharedListIds() {
    var raw = new URLSearchParams(location.search).get('list') || '';
    return raw.split(',').filter(function (id) { return /^[a-z0-9-]{1,80}$/.test(id); }).slice(0, 30);
  }

  function singleListingId() {
    var m = location.pathname.match(/^\/listing\/([a-z0-9-]+)$/);
    return m ? m[1] : null;
  }

  // ---------- search ----------
  // The search itself lives in /js/search.js (everyday words from
  // /content/words.json, ranking, typo tolerance), so it can be tested.
  var engine = null;
  var dictionary = null;
  var lastSearch = { mode: 'all', notes: [], suggestions: [], safety: false };
  // One search per distinct query: the same words are asked for several times
  // per render (results, category counts, the sensitive check), so the last
  // answer is kept until the words change.
  var searchCache = { q: null, result: null };

  function runSearch(q) {
    if (searchCache.q !== q) {
      searchCache.q = q;
      searchCache.result = engine.search(q);
    }
    return searchCache.result;
  }

  // With no search, the full list is A to Z, with names that start with a
  // number ("1115 Waiver…") after the letters, so it opens on plain names.
  var allInOrder = [];
  function defaultOrder(list) {
    return list.filter(function (l) { return !/^\d/.test(l.name); }).concat(list.filter(function (l) { return /^\d/.test(l.name); }));
  }

  function searched() {
    var q = state.q.trim();
    if (!q) {
      lastSearch = { mode: 'all', notes: [], suggestions: [], safety: false };
      return allInOrder;
    }
    if (!engine) { // search.js didn't load: plain text match
      lastSearch = { mode: 'exact', notes: [], suggestions: [], safety: false };
      var lower = q.toLowerCase();
      return data.listings.filter(function (l) { return (l.name + ' ' + l.description + ' ' + l.tags.join(' ')).toLowerCase().indexOf(lower) !== -1; });
    }
    lastSearch = runSearch(q);
    return lastSearch.results;
  }

  // A search or view about domestic violence: show the quick exit and keep the
  // words out of the page address (and so out of browser history).
  // Backup list in case search.js didn't load.
  var DV_WORDS = /\b(abus|beat|hit|hurt|violen|domestic|dv|stalk|rape|assault|batter|restraining|protect|safe ?house|shelter|trafficking|threat|strangl|wellspring)/i;
  function isSensitive() {
    if (state.category === DV) return true;
    var q = state.q.trim();
    if (q) {
      if (!engine) { if (DV_WORDS.test(q)) return true; }
      else {
        var r = runSearch(q);
        if (r.safety || (r.results[0] && r.results[0].category === DV)) return true;
      }
    }
    if (!data) return false;
    var single = singleListingId();
    if (single) {
      var l = findListing(single);
      if (l && l.category === DV) return true;
    }
    return sharedListIds().some(function (id) { var x = findListing(id); return x && x.category === DV; });
  }

  // ---------- filtering ----------
  function has(list, v) { return list.indexOf(v) !== -1; }
  function filtersActive() { return FILTER_KEYS.some(function (k) { return state[k]; }); }

  function matchesFilters(l, skipCategory) {
    if (!skipCategory && state.category && l.category !== state.category) return false;
    if (state.county && !has(l.serves_counties, state.county) && !has(l.serves_counties, 'Regional')) return false;
    if (state.plan && !has(l.medicaid_plans, state.plan)) return false;
    if (state.cost && !has(l.cost, state.cost)) return false;
    if (state.age && l.age_groups.length && !has(l.age_groups, state.age)) return false;
    return true;
  }

  function results() {
    var list = searched().filter(function (l) { return matchesFilters(l, false); });
    // Temporarily closed listings stay visible but move to the end.
    return list.filter(function (l) { return l.status !== 'Temporarily closed'; })
      .concat(list.filter(function (l) { return l.status === 'Temporarily closed'; }));
  }

  // ---------- categories (built once, then updated in place so focus stays) ----------
  function buildCategories() {
    var ul = $('categories');
    var all = el('button', { type: 'button', 'aria-pressed': 'true', onclick: function () { pickCategory(''); } }, 'All');
    categoryButtons[''] = { button: all, li: el('li', {}, all) };
    ul.appendChild(categoryButtons[''].li);
    data.categories.forEach(function (c) {
      var count = el('span', { class: 'count' });
      var b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: function () { pickCategory(state.category === c ? '' : c); } }, c + ' ', count);
      categoryButtons[c] = { button: b, li: el('li', {}, b), count: count };
      ul.appendChild(categoryButtons[c].li);
    });
  }

  function updateCategories() {
    var counts = {};
    searched().forEach(function (l) {
      if (matchesFilters(l, true)) counts[l.category] = (counts[l.category] || 0) + 1;
    });
    Object.keys(categoryButtons).forEach(function (c) {
      var entry = categoryButtons[c];
      entry.button.setAttribute('aria-pressed', String(state.category === c));
      if (c === '') return;
      var n = counts[c] || 0;
      entry.count.textContent = '(' + n + ')';
      entry.li.hidden = n === 0 && state.category !== c;
    });
  }

  function pickCategory(c) {
    setState({ category: c });
    // On phones, close the list and jump to the results so the change is visible.
    if (narrow.matches) {
      $('browse').open = false;
      $('result-status').focus();
      $('result-status').scrollIntoView({ block: 'start' });
    }
  }

  // ---------- cards ----------
  function detail(label, value, cls) {
    if (!value || (Array.isArray(value) && !value.length)) return [];
    return [el('dt', {}, label), el('dd', cls ? { class: cls } : {}, value)];
  }

  function card(l, single) {
    var closed = l.status === 'Temporarily closed';
    var tel = l.phone ? telHref(l.phone) : null;
    var web = l.website ? safeWebsite(l.website) : null;
    var map = mapsHref(l.address);
    var copiedId = 'copied-' + l.id;
    var who = ' for ' + l.name;

    var phoneValue = tel ? el('a', { href: tel }, hidden('Call ' + l.name + ' at '), l.phone) : l.phone;
    var websiteValue = web ? el('a', { href: web }, websiteLabel(web), hidden(' (website' + who + ')')) : null;
    var addressValue = l.address ? (map ? el('a', { href: map }, l.address, hidden(' (opens map)')) : l.address) : null;
    var emailValue = l.email ? el('a', { href: 'mailto:' + l.email }, l.email) : null;
    var medicaid = [l.medicaid_plans.join(', '), l.medicaid_notes].filter(Boolean).join('. ');
    var costs = l.cost.map(function (c) { return COST_LABELS[c] || c; }).join(', ');
    var title = single ? l.name : el('a', { href: '/listing/' + linkId(l), onclick: rememberFromList }, l.name);

    var box = el('input', {
      type: 'checkbox', id: 'h-' + l.id, checked: handout.has(l.id),
      onchange: function (e) { toggleHandout(l.id, e.target.checked); },
    });

    return el('article', { class: 'card' + (closed ? ' is-closed' : ''), 'aria-labelledby': 't-' + l.id },
      el('h2', { id: 't-' + l.id }, title),
      el('p', { class: 'meta' }, [l.category, l.town].filter(Boolean).join(' · ')),
      closed ? el('span', { class: 'badge closed' }, 'Temporarily closed') : null,
      l.status === 'Seasonal' ? el('span', { class: 'badge seasonal' }, 'Seasonal') : null,
      l.description ? el('p', { class: 'desc' }, l.description) : null,
      el('dl', { class: 'details' },
        detail('Phone', phoneValue, 'phone'),
        detail('Fax', l.fax),
        detail('Address', addressValue),
        detail('Hours', l.hours),
        detail('Who can get help', l.eligibility),
        detail('Ages', l.age_groups.join(', ')),
        detail('Cost', costs),
        detail('Insurance', medicaid),
        detail('Website', websiteValue),
        detail('Email', emailValue),
        detail('Serves', l.serves_counties.map(function (c) { return c === 'Regional' ? 'Whole region' : c + ' County'; }).join(', '))
      ),
      el('p', { class: 'verified' }, checkedLine(l), el('span', { class: 'sep', 'aria-hidden': 'true' }, ' · '),
        el('a', { href: l.category === DV ? '/request?type=correction' : '/request?type=correction&listing=' + encodeURIComponent(l.name) + '&id=' + encodeURIComponent(l.id) }, 'Report a correction', hidden(who))),
      sourcesBlock(l, single),
      reportBlock(l, who),
      el('div', { class: 'actions' },
        el('button', { type: 'button', onclick: function () { copy(l.category === DV ? textMessage(l) : shareText(l), copiedId, 'Copied the details'); } }, 'Copy details', hidden(who)),
        el('button', { type: 'button', onclick: function () { textListing(l); } }, 'Text', hidden(' details' + who)),
        el('button', { type: 'button', onclick: function () { copy(listingUrl(l), copiedId, 'Copied the link'); } }, 'Copy link', hidden(who)),
        el('label', { for: 'h-' + l.id }, box, 'Add to handout', hidden(': ' + l.name)),
        el('span', { id: copiedId, class: 'copied', role: 'status' })
      )
    );
  }

  // Each card is built once and kept, so a new search or filter only moves
  // cards around instead of rebuilding them. A kept card remembers its
  // "Did something not work?" state, which is fine.
  var cardNodes = {};
  function cardFor(l, single) {
    var key = l.id + (single ? '|single' : '');
    var node = cardNodes[key];
    if (!node) {
      node = card(l, single);
      cardNodes[key] = node;
    }
    var box = node.querySelector('.actions input[type="checkbox"]');
    if (box) box.checked = handout.has(l.id);
    return node;
  }

  // ---------- rendering ----------
  // Results are drawn a page at a time: the first 24, then more when the
  // visitor presses "Show more" or scrolls near the end.
  var PAGE = 24;
  // Scrolling draws at most this many extra pages per list; after that only
  // the button does, so the page can't run away from the 211 line below it.
  var AUTO_PAGES = 2;
  var pageItems = [];
  var shown = 0;
  var autoAppends = 0;
  var showMoreButton = null;
  var moreWatcher = null;

  // Coming Back from a listing (a full page load on many phones): redraw as
  // many cards as before and return to the same spot. The browser's own scroll
  // restore is turned off, because it runs before the list has loaded and
  // lands at the bottom of a short page. Only a Back/Forward visit restores;
  // a fresh visit to the same search starts at the top with one page.
  var navEntry = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  var restoring = Boolean(navEntry && navEntry.type === 'back_forward');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  function drawnKey() { return 'drawn:' + location.search; }
  function saveDrawn() {
    try { sessionStorage.setItem(drawnKey(), JSON.stringify({ shown: shown, y: Math.round(window.scrollY || 0) })); } catch (e) { /* private mode: start small */ }
  }
  function loadDrawn() {
    try { return JSON.parse(sessionStorage.getItem(drawnKey()) || 'null') || { shown: 0, y: 0 }; } catch (e) { return { shown: 0, y: 0 }; }
  }
  function forgetDrawn() {
    try { sessionStorage.removeItem(drawnKey()); } catch (e) { /* nothing stored */ }
  }
  // The place is saved as the visitor leaves (to a listing, or anywhere).
  window.addEventListener('pagehide', function () {
    if (data && !singleListingId() && !sharedListIds().length) saveDrawn();
  });

  // Draws the next "count" cards (one page unless told otherwise). "focus" is
  // 'new' (the button: move to the first new card so a screen reader isn't
  // dropped), 'auto' (scrolling: stay put, unless the button just disappeared
  // under the keyboard user's focus) or 'none' (printing: never move it).
  function appendPage(focus, count) {
    var list = $('results');
    var next = pageItems.slice(shown, shown + (count || PAGE));
    var first = null;
    next.forEach(function (x) {
      var li = el('li', {}, cardFor(x, false));
      if (!first) first = li;
      list.appendChild(li);
    });
    shown += next.length;
    var hadFocus = document.activeElement === showMoreButton;
    renderShowMore();
    if (first && (focus === 'new' || (focus === 'auto' && hadFocus && $('show-more').hidden))) {
      var link = first.querySelector('h2 a');
      if (link) link.focus();
    }
  }

  function renderShowMore() {
    var box = $('show-more');
    var left = pageItems.length - shown;
    if (!showMoreButton) {
      showMoreButton = el('button', { type: 'button', class: 'secondary', onclick: function () {
        appendPage('new');
        // Say the new count too, since focus alone only reads out one link.
        $('list-live').textContent = 'Showing ' + shown + ' of ' + pageItems.length;
      } });
      box.appendChild(showMoreButton);
    }
    showMoreButton.textContent = 'Show more (' + left + ' left)';
    box.hidden = left <= 0;
    if (left > 0 && autoAppends < AUTO_PAGES) watchShowMore(); else unwatchShowMore();
  }

  function hideShowMore() {
    pageItems = [];
    shown = 0;
    $('show-more').hidden = true;
    unwatchShowMore();
  }

  // Scrolling near the button draws the next page by itself where the
  // browser can watch for that; the button stays for keyboards and old phones.
  function watchShowMore() {
    if (!window.IntersectionObserver) return;
    var box = $('show-more');
    if (!moreWatcher) {
      moreWatcher = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && shown < pageItems.length && autoAppends < AUTO_PAGES) {
            autoAppends++;
            appendPage('auto');
          }
        }
      }, { rootMargin: '300px 0px' });
    }
    // Watch afresh, so a re-render that leaves the button on screen still fires.
    moreWatcher.unobserve(box);
    moreWatcher.observe(box);
  }

  function unwatchShowMore() {
    if (moreWatcher) moreWatcher.unobserve($('show-more'));
  }

  // The browser's own Print (not the handout) should print every match, not
  // just the cards drawn so far.
  window.addEventListener('beforeprint', function () {
    if (document.body.classList.contains('print-handout')) return;
    if (shown < pageItems.length) appendPage('none', pageItems.length - shown);
  });

  // One visible way to start over when a search, category or filter is on
  // (the filters panel, with its own clear button, is usually closed).
  var clearButton = null;
  function renderClear(show) {
    var box = $('result-clear');
    if (!box) return;
    if (!show) { box.hidden = true; return; }
    var onlySearch = state.q.trim() && !Object.keys(state).some(function (k) { return k !== 'q' && state[k]; });
    if (!clearButton) {
      // Focus lands on the result line, not the search box: on a phone the
      // box would pop the keyboard up over the freshly cleared list.
      clearButton = el('button', { type: 'button', class: 'secondary', onclick: function () { clearAll('result-status'); } });
      box.appendChild(clearButton);
    }
    clearButton.textContent = onlySearch ? 'Clear search' : 'Clear all';
    box.hidden = false;
  }

  // "focusId" is where focus goes afterwards: the search box from the filters
  // panel, the result line from the button in the results.
  function clearAll(focusId) {
    // Forget the drawn count for the old search, and for the fresh full list.
    forgetDrawn();
    setState({ q: '', category: '', county: '', plan: '', cost: '', age: '' });
    forgetDrawn();
    $(focusId || 'search').focus();
  }

  function renderList() {
    var single = singleListingId();
    var list = $('results');

    if (single) {
      restoring = false;
      hideShowMore();
      renderClear(false);
      var l = findListing(single);
      // A DV listing opened by its old, named address: swap in the neutral one.
      if (l && l.category === DV && single !== neutralId(l.id)) history.replaceState(null, '', '/listing/' + neutralId(l.id));
      $('finder').hidden = true;
      showBackLink();
      $('plan-note').hidden = true;
      if (!l) {
        document.title = 'Listing not found: ' + SITE_NAME;
        $('page-title').textContent = 'Listing not found';
        setChildren($('result-status'), ['That listing was not found. It may have moved or closed. ', el('a', { href: '/' }, 'Search all resources'), ', or call ', el('a', { href: 'tel:211' }, '211'), ' for help.']);
        setChildren(list, []);
        return;
      }
      // Domestic violence listings get a neutral tab title (it shows in history).
      document.title = l.category === 'Domestic Violence' ? 'Local help: ' + SITE_NAME : l.name + ': ' + SITE_NAME;
      $('page-title').textContent = l.name;
      toggleQuickExit(l.category === 'Domestic Violence');
      $('result-status').textContent = '';
      // The card drawn early is already here: keep it (and the keyboard focus).
      var node = cardFor(l, true);
      if (node.parentNode && node.parentNode.parentNode === list) return;
      setChildren(list, [el('li', {}, node)]);
      return;
    }

    var shared = sharedListIds();
    if (shared.length) {
      restoring = false;
      hideShowMore();
      renderClear(false);
      var picked = shared.map(findListing).filter(Boolean);
      // A domestic violence listing named by its real id: switch the address
      // to the neutral ones, as a single listing link does.
      var neutralList = picked.map(linkId).join(',');
      if (picked.some(function (x) { return x.category === DV; }) && neutralList !== shared.join(',')) {
        history.replaceState(null, '', '/?list=' + neutralList);
      }
      $('finder').hidden = true;
      showBackLink();
      $('plan-note').hidden = true;
      $('page-title').textContent = 'Shared list';
      document.title = 'Shared list: ' + SITE_NAME;
      // A list with a domestic violence listing gets the quick exit too.
      toggleQuickExit(isSensitive());
      $('result-status').textContent = picked.length
        ? 'Someone shared ' + picked.length + (picked.length === 1 ? ' resource' : ' resources') + ' with you.'
          + (picked.length < shared.length ? ' Some on the list are no longer listed.' : '')
        : 'These resources are no longer listed. Search all resources, or call 211.';
      setChildren(list, picked.map(function (x) { return el('li', {}, cardFor(x, false)); }));
      return;
    }

    $('finder').hidden = false;
    $('back-link').hidden = true;
    rememberList(location.pathname + location.search);
    var items = results();
    var total = data.listings.length;
    var active = Object.keys(state).some(function (k) { return k === 'q' ? state.q.trim() : state[k]; });
    var mode = lastSearch.mode;
    var blocked = !items.length && blockingFilters().length > 0;
    $('result-status').textContent = !items.length
      ? (blocked ? 'No matches with the filters you chose. Remove one below, or ' + HELP_LINE + '.' : 'No matches. Try different words or pick a category below, or ' + HELP_LINE + '.')
      : mode === 'unsure'
        ? 'We\'re not sure what you meant by "' + state.q.trim() + '". These are guesses. Try a category below, or ' + HELP_LINE + '.'
        : (mode === 'partial'
          ? (lastSearch.corrected ? 'Showing results for "' + lastSearch.corrected + '": ' : 'Showing ') + items.length + ' resources that match some of your words.'
          : lastSearch.corrected
            ? 'Showing results for "' + lastSearch.corrected + '": ' + items.length + ' of ' + total + ' resources.'
            : 'Showing ' + items.length + ' of ' + total + ' resources' + (active ? ' that match' : '') + '.')
          + wishesLine();
    var n = FILTER_KEYS.filter(function (k) { return state[k]; }).length;
    $('filter-count').textContent = n ? (n === 1 ? '1 filter on' : n + ' filters on') + ': ' + items.length + (items.length === 1 ? ' result' : ' results') : '';
    renderSearchHelp(items.length);
    renderClear(active);
    renderPlanNote();
    // Start again from the first page (the count above reports every match),
    // or from as many cards as were drawn before, when coming Back to this
    // same search.
    setChildren(list, []);
    $('list-live').textContent = '';
    pageItems = items;
    shown = 0;
    autoAppends = 0;
    var place = restoring ? loadDrawn() : { shown: 0, y: 0 };
    appendPage('auto', place.shown > PAGE ? Math.min(place.shown, pageItems.length) : PAGE);
    if (restoring) {
      restoring = false;
      if (place.y) window.scrollTo(0, place.y);
    }
  }

  // What the search understood as wishes rather than needs: a place, or free
  // and low-cost help. Those come first; nothing else is hidden.
  function wishesLine() {
    if (!state.q.trim()) return '';
    var place = lastSearch.places && lastSearch.places.length;
    return (place ? ' Places in or serving ' + lastSearch.places.join(' and ') + ' come first.' : '')
      + (lastSearch.lowCost ? ' Free and low-cost places come ' + (place ? 'next.' : 'first.') : '');
  }

  // Filters (and the category) whose removal would bring results back.
  function blockingFilters() {
    return FILTER_KEYS.concat(['category']).filter(function (k) {
      if (!state[k]) return false;
      var patch = {};
      patch[k] = '';
      return countWith(patch) > 0;
    });
  }

  // How many results there would be with one filter (or the category) taken off.
  var FILTER_KEYS = ['county', 'plan', 'cost', 'age'];
  var FILTER_LABELS = { county: 'County', plan: 'Insurance', cost: 'Cost', age: 'Age group', category: 'Category' };
  // Leaves the page's own search untouched (state, last result, cache).
  function countWith(patch) {
    var saved = {};
    var keptSearch = lastSearch;
    var keptCache = searchCache;
    Object.keys(patch).forEach(function (k) { saved[k] = state[k]; state[k] = patch[k]; });
    var n = results().length;
    Object.keys(saved).forEach(function (k) { state[k] = saved[k]; });
    lastSearch = keptSearch;
    searchCache = keptCache;
    return n;
  }
  function filterValueLabel(k, v) {
    return k === 'county' ? v + ' County' : k === 'cost' ? COST_LABELS[v] || v : k === 'plan' && v === UNSPECIFIED_PLAN ? PLAN_UNLISTED_LABEL : v;
  }

  // The insurance filter shows only places known to take that plan. Many
  // others take Medicaid but haven't said which plans: one tap shows those.
  function renderPlanNote() {
    var note = $('plan-note');
    note.hidden = !state.plan;
    if (!state.plan) { setChildren(note, []); return; }
    if (state.plan === UNSPECIFIED_PLAN) {
      setChildren(note, ['Showing places that take Medicaid but haven\'t said which plans. Call to check that they take yours.']);
      return;
    }
    var medicaidPlan = !/medicare/i.test(state.plan) && data.medicaid_plans.indexOf(UNSPECIFIED_PLAN) !== -1;
    setChildren(note, ['Showing places known to take ' + state.plan + '. Always call to confirm. ',
      medicaidPlan ? el('button', { type: 'button', class: 'linklike', onclick: function () { setState({ plan: UNSPECIFIED_PLAN }); $('result-status').focus(); } },
        'Instead, show places that take Medicaid but haven\'t listed plans') : null]);
  }

  // Plain explainers ("DSS = your county's Department of Social Services") and,
  // when the search wasn't understood, category suggestions to tap.
  // Categories where people choose among many providers: point to the full
  // official list too, so this directory never looks like the only choice.
  var CARE_COMPARE = ['Home Care', 'Senior Living and Nursing Homes', 'Hospice and Caregiver Support'];
  function careCompareNote() {
    return el('p', {}, 'Choosing a nursing home, home health agency or hospice? Medicare\u2019s ',
      el('a', { href: 'https://www.medicare.gov/care-compare/', rel: 'noopener' }, 'Care Compare'),
      ' lists every Medicare-approved option near you, with ratings. This directory lists only some of them.');
  }

  function renderSearchHelp(count) {
    var notes = state.q.trim() ? lastSearch.notes : [];
    var nodes = notes.map(function (n) { return el('p', {}, withPhoneLinks(n)); });
    setChildren($('search-note'), nodes);
    $('search-note').hidden = !nodes.length;
    // Not a live region, and only rebuilt when it changes, so screen readers don't repeat it.
    var wantCare = CARE_COMPARE.indexOf(state.category) !== -1;
    var catNote = $('category-note');
    if (catNote && catNote.hidden === wantCare) {
      setChildren(catNote, wantCare ? [careCompareNote()] : []);
      catNote.hidden = !wantCare;
    }
    var suggest = (lastSearch.mode === 'unsure' || !count) && state.q.trim()
      ? (lastSearch.suggestions.length ? lastSearch.suggestions : ['Food', 'Rent, Utility and Emergency Help', 'Housing and Shelter', 'Medical'])
          .filter(function (c) { return data.categories.indexOf(c) !== -1; })
      : [];
    // No matches because of the filters: one button per filter, with how many
    // results taking it off would give.
    // (Only filters whose removal brings results back; "Clear all" is always there.)
    var blocking = !count ? blockingFilters() : [];
    var nodes = [];
    if (blocking.length) {
      nodes.push(el('p', {}, 'Or remove a filter:'), el('div', { class: 'suggest-buttons' }, blocking.map(function (k) {
        var patch = {};
        patch[k] = '';
        var n = countWith(patch);
        return el('button', { type: 'button', class: 'secondary', onclick: function () { setState(patch); $('result-status').focus(); } },
          'Remove ' + FILTER_LABELS[k] + ': ' + filterValueLabel(k, state[k]) + ' (' + n + (n === 1 ? ' result)' : ' results)'));
      })));
    }
    // A guessed spelling can always be undone: search the words exactly as typed.
    if (lastSearch.corrected && state.q.trim()) {
      var typed = state.q.trim();
      nodes.push(el('p', {}, el('button', { type: 'button', class: 'linklike', onclick: function () { setState({ q: '"' + typed + '"' }); $('result-status').focus(); } },
        'Search for "' + typed + '" exactly as typed')));
    }
    if (suggest.length) {
      nodes.push(el('p', {}, lastSearch.mode === 'unsure' ? 'Did you mean:' : 'Or try a category:'), el('div', { class: 'suggest-buttons' }, suggest.map(function (c) {
        // Keep the filters if the category has matches with them; otherwise drop them.
        var keep = countWith({ q: '', category: c }) > 0;
        return el('button', { type: 'button', class: 'secondary', onclick: function () {
          setState(keep ? { q: '', category: c } : { q: '', category: c, county: '', plan: '', cost: '', age: '' });
          $('result-status').focus();
        } }, c, keep || !filtersActive() ? '' : ' (all filters off)');
      })));
    }
    setChildren($('search-suggest'), nodes);
    $('search-suggest').hidden = !nodes.length;
    toggleQuickExit(isSensitive());
  }

  // Phone numbers inside a note become tap-to-call links (text stays text).
  function withPhoneLinks(text) {
    var parts = String(text).split(/(\(\d{3}\) \d{3}-\d{4}|1-\d{3}-\d{3}-\d{4}|\b988\b|\b911\b|\b211\b)/);
    return parts.map(function (part, i) {
      if (i % 2 === 0) return part ? document.createTextNode(part) : null;
      return el('a', { href: 'tel:' + part.replace(/[^\d]/g, '') }, part);
    });
  }

  function toggleQuickExit(on) {
    if (window.SADKSafety) window.SADKSafety.show(on);
  }

  function renderFilterControls() {
    var selects = document.querySelectorAll('.filter-grid select');
    for (var i = 0; i < selects.length; i++) selects[i].value = state[selects[i].getAttribute('data-key')] || '';
    if ($('search').value !== state.q) $('search').value = state.q;
    var n = FILTER_KEYS.filter(function (k) { return state[k]; }).length;
    if (!n) $('filter-count').textContent = '';
    $('browse-current').textContent = state.category ? 'Showing: ' + state.category : '';
    if (n) $('filters').open = true;
  }

  function render() {
    if (!$('search')) return; // page already emptied by "Leave this site"
    if (!data) return; // still loading: the search is kept and drawn when the list arrives
    // A domestic-violence view opened from a link: take the words out of the
    // address so they don't stay in browser history.
    if (isSensitive() && (location.search.indexOf('q=') !== -1 || location.search.indexOf('category=') !== -1)) writeUrl();
    renderFilterControls();
    updateCategories();
    renderList();
    renderHandoutBar();
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    writeUrl();
    render();
  }

  // ---------- copy and text ----------
  function copy(text, statusId, message) {
    function done(ok) {
      var status = $(statusId);
      if (!status) return;
      status.textContent = ok ? message : 'Could not copy. Select the text and copy it yourself.';
      setTimeout(function () { status.textContent = ''; }, 4000);
    }
    function fallback() {
      var ta = el('textarea', { class: 'visually-hidden', readonly: true });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function textListing(l) {
    location.href = 'sms:?&body=' + encodeURIComponent(textMessage(l));
  }

  // ---------- handout ----------
  function loadHandout() {
    try { return new Set(JSON.parse(sessionStorage.getItem(HANDOUT_KEY) || '[]')); } catch (e) { return new Set(); }
  }

  function saveHandout() {
    try { sessionStorage.setItem(HANDOUT_KEY, JSON.stringify(Array.from(handout))); } catch (e) { /* private mode: keep in memory */ }
  }

  function toggleHandout(id, on) {
    if (on) handout.add(id); else handout.delete(id);
    saveHandout();
    renderHandoutBar();
    $('handout-live').textContent = $('handout-count').textContent + '. The Print handout button is at the bottom of the screen.';
  }

  function renderHandoutBar() {
    var n = data ? data.listings.filter(function (l) { return handout.has(l.id); }).length : 0;
    $('handout-bar').hidden = n === 0;
    $('handout-count').textContent = n + ' on your handout';
    // Short labels on phones keep the pinned bar to one short row.
    if (!preparingPrint) $('handout-print').textContent = (narrow.matches ? 'Print (' : 'Print handout (') + n + ')';
    $('handout-share').textContent = narrow.matches ? 'Share' : 'Share list';
  }

  // The QR code maker (/js/qr.js) is only needed for printing, so it is
  // fetched the first time someone prints, not on every visit.
  var qrLoading = null;
  function loadQr() {
    if (window.QR) return Promise.resolve();
    if (qrLoading) return qrLoading;
    qrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/js/qr.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { qrLoading = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return qrLoading;
  }

  // A small QR code (print only, so hidden from screen readers). Made by
  // /js/qr.js; if that didn't load, the handout simply has none.
  function qrCode(url, cls) {
    if (!window.QR) return null;
    try {
      var svg = window.QR.svg(url, { label: '' });
      svg.setAttribute('class', cls);
      return svg;
    } catch (e) { return null; }
  }

  // One link to everything on the handout: the phone's share menu where there
  // is one, otherwise the link is copied.
  function shareHandout() {
    var chosen = data.listings.filter(function (l) { return handout.has(l.id); });
    if (!chosen.length) return;
    var url = location.origin + '/?list=' + chosen.map(linkId).join(',');
    var text = 'Resources from ' + SITE_NAME + ':\n' + chosen.map(function (l) {
      return l.category === DV ? '- Help line: ' + (l.phone || '211') : '- ' + l.name + (l.phone ? ' ' + l.phone : '');
    }).join('\n');
    if (navigator.share) {
      navigator.share({ title: 'Resources from ' + SITE_NAME, text: text, url: url }).catch(function () { /* closed */ });
    } else {
      copy(text + '\n' + url, 'handout-live', 'Link to your list copied. Paste it into a text or email.');
      var btn = $('handout-share');
      btn.textContent = 'Link copied \u2713';
      clearTimeout(shareHandout.timer);
      shareHandout.timer = setTimeout(renderHandoutBar, 4000);
    }
  }

  // Print straight away when the QR maker is here. Otherwise the button says
  // "Preparing…" while it is fetched, for at most 3 seconds; then the handout
  // prints with codes if the maker arrived and without them if not. A second
  // tap while preparing does nothing, so only one print dialog opens.
  var preparingPrint = false;
  function printHandout() {
    if (preparingPrint) return;
    var chosen = data.listings.filter(function (l) { return handout.has(l.id); });
    if (!chosen.length) return;
    var btn = $('handout-print');
    var done = false;
    function go() {
      if (done) return;
      done = true;
      preparingPrint = false;
      btn.disabled = false;
      renderHandoutBar();
      // A disabled button drops keyboard focus; give it back.
      if (document.activeElement === document.body) btn.focus();
      buildHandout(chosen);
      document.body.classList.add('print-handout');
      window.print();
    }
    if (window.QR) { go(); return; }
    preparingPrint = true;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    setTimeout(go, 3000);
    loadQr().then(go, go);
  }

  function buildHandout(chosen) {
    var today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    setChildren($('handout'), [
      el('h1', {}, 'Local resources'),
      el('p', { class: 'sub' }, 'From ' + SITE_NAME + (SITE.domain ? ', ' + SITE.domain : '') + '. Printed ' + today + '.'),
      el('ol', {}, chosen.map(function (l) {
        return el('li', {},
          qrCode(listingUrl(l), 'hq'),
          el('h2', {}, l.name, l.status !== 'Active' ? ' (' + l.status + ')' : ''),
          l.phone ? el('p', {}, 'Phone: ' + l.phone) : null,
          l.address ? el('p', {}, 'Address: ' + l.address) : null,
          l.hours ? el('p', {}, 'Hours: ' + l.hours) : null,
          l.eligibility ? el('p', {}, 'Who can get help: ' + l.eligibility) : null,
          l.website ? el('p', {}, websiteLabel(l.website)) : null);
      })),
      el('div', { class: 'foot-qr' }, qrCode(location.origin + '/', 'hq-site'),
        el('p', {}, 'Scan for these and more: ' + (SITE.domain || location.host))),
      el('p', { class: 'foot' }, 'Can\'t find it? ' + HELP_LINE.charAt(0).toUpperCase() + HELP_LINE.slice(1) + '. A listing is not an endorsement; call ahead to confirm. In crisis: call or text 988, or call 911.'),
    ]);
  }

  window.addEventListener('afterprint', function () { document.body.classList.remove('print-handout'); });

  // ---------- setup ----------
  function fillSelect(id, values, labelFor) {
    var sel = $(id);
    values.forEach(function (v) { sel.appendChild(el('option', { value: v }, labelFor ? labelFor(v) : v)); });
  }

  function wireControls() {
    var timer;
    $('search').addEventListener('input', function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () { setState({ q: e.target.value }); }, 200);
    });
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(timer);
      setState({ q: $('search').value });
      $('result-status').focus();
    });
    var selects = document.querySelectorAll('.filter-grid select');
    Array.prototype.forEach.call(selects, function (sel) {
      sel.addEventListener('change', function () {
        var patch = {};
        patch[sel.getAttribute('data-key')] = sel.value;
        setState(patch);
      });
    });
    $('clear-filters').addEventListener('click', function () { clearAll('search'); });
    $('handout-print').addEventListener('click', printHandout);
    $('handout-share').addEventListener('click', shareHandout);
    $('handout-clear').addEventListener('click', function () {
      handout = new Set();
      saveHandout();
      var boxes = document.querySelectorAll('.actions input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      renderHandoutBar();
    });
    window.addEventListener('popstate', function () { readUrl(); render(); });
  }

  // A listing's own page carries that listing (see src/routes/pages.js), so
  // its card is drawn at once; the full directory still loads for search.
  var earlyCard = null;
  function drawEarlyListing() {
    var node = $('listing-data');
    var id = singleListingId();
    if (!node || !id) return;
    var l;
    try { l = JSON.parse(node.textContent); } catch (e) { return; }
    if (!l || l.id !== id || l.category === DV) return;
    $('finder').hidden = true;
    showBackLink();
    document.title = l.name + ': ' + SITE_NAME;
    $('page-title').textContent = l.name;
    $('result-status').textContent = '';
    earlyCard = { json: JSON.stringify(l), node: cardFor(l, true) };
    setChildren($('results'), [el('li', {}, earlyCard.node)]);
  }

  function start() {
    // Categories start open on wider screens, closed on phones so results come first
    // (the summary line still says which category is showing).
    if (!narrow.matches) $('browse').open = true;
    wireControls();
    readUrl();
    drawEarlyListing();
    // The everyday-words list is optional: search still works without it.
    var words = fetch('/content/words.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    // A stuck words list must never hold the listings back.
    words = Promise.race([words, new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 6000); })]);
    fetch('/api/listings', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (res.headers.get('X-From-Offline-Copy')) showOfflineNote(res.headers.get('X-Saved-At'));
        return res.json();
      })
      .then(function (json) { return words.then(function (w) { dictionary = w; return json; }); })
      .then(function (json) {
        data = json;
        // Fresh data means fresh cards and a fresh search. The card drawn early
        // stays (with any focus or open "Did something not work?") if unchanged.
        cardNodes = {};
        if (earlyCard) {
          var same = json.listings.filter(function (x) { return JSON.stringify(x) === earlyCard.json; })[0];
          if (same) cardNodes[same.id + '|single'] = earlyCard.node;
        }
        searchCache = { q: null, result: null };
        fillSelect('f-county', data.counties.filter(function (c) { return c !== 'Regional'; }), function (c) { return c + ' County'; });
        fillSelect('f-plan', data.medicaid_plans.filter(function (p) { return p !== UNSPECIFIED_PLAN; }));
        // Last, and in plain words: places that take Medicaid but haven't said which plans.
        if (data.medicaid_plans.indexOf(UNSPECIFIED_PLAN) !== -1) $('f-plan').appendChild(el('option', { value: UNSPECIFIED_PLAN }, PLAN_UNLISTED_LABEL));
        fillSelect('f-cost', data.costs, function (c) { return COST_LABELS[c] || c; });
        fillSelect('f-age', data.age_groups);
        engine = window.SADKSearch ? window.SADKSearch.create(data.listings, dictionary, { towns: data.towns, counties: data.counties }) : null;
        allInOrder = defaultOrder(data.listings);
        searchCache = { q: null, result: null };
        buildCategories();
        render();
      })
      .catch(function () {
        if (earlyCard) return; // the listing is already showing; only search is missing
        $('result-status').textContent = FALLBACK;
        // One clear way to try again (a weak signal often comes back).
        setChildren($('result-clear'), [el('button', { type: 'button', class: 'secondary', onclick: function () { location.reload(); } }, 'Try again')]);
        $('result-clear').hidden = false;
      });
  }

  try {
    start();
  } catch (e) {
    $('result-status').textContent = FALLBACK;
  }
})();
