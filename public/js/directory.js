// Public directory: loads the public listings once, then searches and filters
// them in the browser. All listing text is inserted with textContent, never
// as HTML. Written for older phones too (no ?. ?? or replaceChildren).

(function () {
  'use strict';

  var PARAMS = { q: 'q', category: 'category', county: 'county', plan: 'plan', cost: 'cost', age: 'age' };
  var UNSPECIFIED_PLAN = 'Medicaid (call to check plan)';
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
    flatten(children).forEach(function (c) { if (c) node.appendChild(c); });
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
    note.textContent = 'You are offline. Showing the copy saved on this device on ' + when + '. Calls and texts still work; details may have changed.';
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

  function searched() {
    var q = state.q.trim();
    if (!q) {
      lastSearch = { mode: 'all', notes: [], suggestions: [], safety: false };
      return data.listings;
    }
    if (!engine) { // search.js didn't load: plain text match
      lastSearch = { mode: 'exact', notes: [], suggestions: [], safety: false };
      var lower = q.toLowerCase();
      return data.listings.filter(function (l) { return (l.name + ' ' + l.description + ' ' + l.tags.join(' ')).toLowerCase().indexOf(lower) !== -1; });
    }
    lastSearch = engine.search(q);
    return lastSearch.results;
  }

  // A search or view about domestic violence: show the quick exit and keep the
  // words out of the page address (and so out of browser history).
  // Backup list in case search.js didn't load.
  var DV_WORDS = /\b(abus|beat|hit|hurt|violen|domestic|dv|stalk|rape|assault|batter|restraining|protect|safe ?house|shelter|trafficking|threat|strangl|wellspring)/i;
  function isSensitive() {
    if (state.category === DV) return true;
    if (state.q) {
      if (!engine) { if (DV_WORDS.test(state.q)) return true; }
      else {
        var r = engine.search(state.q);
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
    var title = single ? l.name : el('a', { href: '/listing/' + linkId(l) }, l.name);

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

  // ---------- rendering ----------
  function renderList() {
    var single = singleListingId();
    var list = $('results');

    if (single) {
      var l = findListing(single);
      // A DV listing opened by its old, named address: swap in the neutral one.
      if (l && l.category === DV && single !== neutralId(l.id)) history.replaceState(null, '', '/listing/' + neutralId(l.id));
      $('finder').hidden = true;
      $('back-link').hidden = false;
      $('plan-note').hidden = true;
      if (!l) {
        document.title = 'Listing not found: ' + SITE_NAME;
        $('result-status').textContent = 'That listing was not found. It may have moved or closed. Call 211 for help.';
        setChildren(list, []);
        return;
      }
      // Domestic violence listings get a neutral tab title (it shows in history).
      document.title = l.category === 'Domestic Violence' ? 'Local help: ' + SITE_NAME : l.name + ': ' + SITE_NAME;
      $('page-title').textContent = l.name;
      toggleQuickExit(l.category === 'Domestic Violence');
      $('result-status').textContent = '';
      setChildren(list, [el('li', {}, card(l, true))]);
      return;
    }

    var shared = sharedListIds();
    if (shared.length) {
      var picked = shared.map(findListing).filter(Boolean);
      $('finder').hidden = true;
      $('back-link').hidden = false;
      $('plan-note').hidden = true;
      $('page-title').textContent = 'Shared list';
      document.title = 'Shared list: ' + SITE_NAME;
      $('result-status').textContent = picked.length
        ? 'Someone shared ' + picked.length + (picked.length === 1 ? ' resource' : ' resources') + ' with you.'
          + (picked.length < shared.length ? ' Some on the list are no longer listed.' : '')
        : 'These resources are no longer listed. Search all resources, or call 211.';
      setChildren(list, picked.map(function (x) { return el('li', {}, card(x, false)); }));
      return;
    }

    $('finder').hidden = false;
    $('back-link').hidden = true;
    var items = results();
    var total = data.listings.length;
    var active = Object.keys(state).some(function (k) { return state[k]; });
    var mode = lastSearch.mode;
    $('result-status').textContent = !items.length
      ? 'No matches. Try different words or pick a category below, or ' + HELP_LINE + '.'
      : mode === 'unsure'
        ? 'We\'re not sure what you meant by "' + state.q.trim() + '". These are guesses. Try a category below, or ' + HELP_LINE + '.'
        : mode === 'partial'
          ? 'Showing ' + items.length + ' resources that match some of your words.'
          : 'Showing ' + items.length + ' of ' + total + ' resources' + (active ? ' that match' : '') + '.';
    renderSearchHelp(items.length);
    $('plan-note').hidden = !state.plan;
    $('plan-note').textContent = state.plan
      ? 'Showing places known to take ' + state.plan + '. Some other places take Medicaid but haven\'t said which plans; search "medicaid" to see them. Always call to confirm.'
      : '';
    setChildren(list, items.map(function (x) { return el('li', {}, card(x, false)); }));
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
    setChildren($('search-suggest'), suggest.length ? [
      el('p', {}, lastSearch.suggestions.length ? 'Did you mean:' : 'Or try a category:'),
      el('div', { class: 'suggest-buttons' }, suggest.map(function (c) {
        return el('button', { type: 'button', class: 'secondary', onclick: function () { setState({ q: '', category: c }); $('result-status').focus(); } }, c);
      })),
    ] : []);
    $('search-suggest').hidden = !suggest.length;
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
    var n = ['county', 'plan', 'cost', 'age'].filter(function (k) { return state[k]; }).length;
    $('filter-count').textContent = n ? n + (n === 1 ? ' filter on' : ' filters on') : '';
    $('browse-current').textContent = state.category ? 'Showing: ' + state.category : '';
    if (n) $('filters').open = true;
  }

  function render() {
    if (!$('search')) return; // page already emptied by "Leave this site"
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
    $('handout-print').textContent = (narrow.matches ? 'Print (' : 'Print handout (') + n + ')';
    $('handout-share').textContent = narrow.matches ? 'Share' : 'Share list';
  }

  // A small QR code (print only, so hidden from screen readers). Made by
  // /js/qr.js on this page; if that didn't load, the handout simply has none.
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

  function printHandout() {
    var chosen = data.listings.filter(function (l) { return handout.has(l.id); });
    if (!chosen.length) return;
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
    document.body.classList.add('print-handout');
    window.print();
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
    $('clear-filters').addEventListener('click', function () {
      setState({ q: '', category: '', county: '', plan: '', cost: '', age: '' });
      $('search').focus();
    });
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

  function start() {
    // Categories start open on wider screens, closed on phones so results come first
    // (the summary line still says which category is showing).
    if (!narrow.matches) $('browse').open = true;
    wireControls();
    readUrl();
    // The everyday-words list is optional: search still works without it.
    var words = fetch('/content/words.json', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    fetch('/api/listings', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (res.headers.get('X-From-Offline-Copy')) showOfflineNote(res.headers.get('X-Saved-At'));
        return res.json();
      })
      .then(function (json) { return words.then(function (w) { dictionary = w; return json; }); })
      .then(function (json) {
        data = json;
        fillSelect('f-county', data.counties.filter(function (c) { return c !== 'Regional'; }), function (c) { return c + ' County'; });
        fillSelect('f-plan', data.medicaid_plans.filter(function (p) { return p !== UNSPECIFIED_PLAN; }));
        fillSelect('f-cost', data.costs, function (c) { return COST_LABELS[c] || c; });
        fillSelect('f-age', data.age_groups);
        engine = window.SADKSearch ? window.SADKSearch.create(data.listings, dictionary) : null;
        buildCategories();
        render();
      })
      .catch(function () {
        $('result-status').textContent = FALLBACK;
      });
  }

  try {
    start();
  } catch (e) {
    $('result-status').textContent = FALLBACK;
  }
})();
