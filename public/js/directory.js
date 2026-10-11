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

  function listingUrl(id) { return location.origin + '/listing/' + id; }

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
    Object.keys(PARAMS).forEach(function (key) { if (state[key]) p.set(PARAMS[key], state[key]); });
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
  // Pass 1: every typed word must start a word in the listing ("rent" finds
  // "rent" and "rental", not "parent"). Pass 2, only if pass 1 finds nothing:
  // allow small typos, 1 letter off for short words and 2 for long ones
  // ("dentst" finds "dentist"). Words nowhere close find nothing; 211 is shown.
  var FIELD_WEIGHTS = { name: 3, tags: 2, category: 1.5, organization: 1, town: 1, description: 0.7, eligibility: 0.5 };
  var wordIndex = [];
  var lastSearchWasFuzzy = false;

  function words(text) {
    var s = String(text).toLowerCase();
    if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return s.split(/[^a-z0-9]+/).filter(Boolean);
  }

  function buildWordIndex() {
    wordIndex = data.listings.map(function (l) {
      return {
        listing: l,
        fields: Object.keys(FIELD_WEIGHTS).map(function (f) {
          return [f, words(Array.isArray(l[f]) ? l[f].join(' ') : l[f])];
        }),
      };
    });
  }

  // Edit distance with swapped neighbours counting as one edit.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [];
    for (var i = 0; i <= a.length; i++) { d.push([i]); }
    for (var j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      var rowMin = Infinity;
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function closeEnough(term, word) {
    var max = term.length <= 3 ? 0 : term.length <= 6 ? 1 : 2;
    if (max === 0) return false;
    return [word, word.slice(0, term.length), word.slice(0, term.length + 1)].some(function (w) {
      return editDistance(term, w, max) <= max;
    });
  }

  function wordSearch(q, fuzzy) {
    var terms = words(q);
    if (!terms.length) return [];
    var hits = [];
    wordIndex.forEach(function (entry) {
      var score = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var best = 0;
        entry.fields.forEach(function (pair) {
          var weight = FIELD_WEIGHTS[pair[0]];
          if (pair[1].some(function (w) { return w.indexOf(term) === 0; })) best = Math.max(best, weight);
          else if (fuzzy && pair[1].some(function (w) { return closeEnough(term, w); })) best = Math.max(best, weight * 0.6);
        });
        if (!best) return;
        score += best;
      }
      hits.push({ listing: entry.listing, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.listing.name.localeCompare(b.listing.name); });
    return hits.map(function (h) { return h.listing; });
  }

  function searched() {
    var q = state.q.trim();
    lastSearchWasFuzzy = false;
    if (!q) return data.listings;
    var exact = wordSearch(q, false);
    if (exact.length) return exact;
    lastSearchWasFuzzy = true;
    return wordSearch(q, true);
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
    var title = single ? l.name : el('a', { href: '/listing/' + l.id }, l.name);

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
      el('p', { class: 'verified' }, l.last_verified ? 'Last verified: ' + formatDate(l.last_verified) : 'Not yet verified', ' · ',
        el('a', { href: '/request?type=correction&listing=' + encodeURIComponent(l.name) + '&id=' + encodeURIComponent(l.id) }, 'Report a change', hidden(who))),
      el('div', { class: 'actions' },
        el('button', { type: 'button', onclick: function () { copy(shareText(l), copiedId, 'Copied the details'); } }, 'Copy details', hidden(who)),
        el('button', { type: 'button', onclick: function () { textListing(l); } }, 'Text', hidden(' details' + who)),
        el('button', { type: 'button', onclick: function () { copy(listingUrl(l.id), copiedId, 'Copied the link'); } }, 'Copy link', hidden(who)),
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
      var l = data.listings.filter(function (x) { return x.id === single; })[0];
      $('finder').hidden = true;
      $('back-link').hidden = false;
      $('plan-note').hidden = true;
      if (!l) {
        document.title = 'Listing not found: ' + SITE_NAME;
        $('result-status').textContent = 'That listing was not found. It may have moved or closed. Call 211 for help.';
        setChildren(list, []);
        return;
      }
      document.title = l.name + ': ' + SITE_NAME;
      $('page-title').textContent = l.name;
      $('result-status').textContent = '';
      setChildren(list, [el('li', {}, card(l, true))]);
      return;
    }

    var shared = sharedListIds();
    if (shared.length) {
      var byId = {};
      data.listings.forEach(function (x) { byId[x.id] = x; });
      var picked = shared.map(function (id) { return byId[id]; }).filter(Boolean);
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
    $('result-status').textContent = items.length
      ? 'Showing ' + items.length + ' of ' + total + ' resources' + (active ? ' that match' : '')
        + (lastSearchWasFuzzy ? ' (closest matches for "' + state.q.trim() + '")' : '') + '.'
      : 'No matches. Try fewer or different words, or clear the filters. Or call 211.';
    $('plan-note').hidden = !state.plan;
    $('plan-note').textContent = state.plan
      ? 'Showing places known to take ' + state.plan + '. Some other places take Medicaid but haven\'t said which plans; search "medicaid" to see them. Always call to confirm.'
      : '';
    setChildren(list, items.map(function (x) { return el('li', {}, card(x, false)); }));
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
    location.href = 'sms:?&body=' + encodeURIComponent(shareText(l));
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
    var url = location.origin + '/?list=' + chosen.map(function (l) { return l.id; }).join(',');
    var text = 'Resources from ' + SITE_NAME + ':\n' + chosen.map(function (l) { return '- ' + l.name + (l.phone ? ' ' + l.phone : ''); }).join('\n');
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
          qrCode(location.origin + '/listing/' + l.id, 'hq'),
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
    fetch('/api/listings', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (res.headers.get('X-From-Offline-Copy')) showOfflineNote(res.headers.get('X-Saved-At'));
        return res.json();
      })
      .then(function (json) {
        data = json;
        fillSelect('f-county', data.counties.filter(function (c) { return c !== 'Regional'; }), function (c) { return c + ' County'; });
        fillSelect('f-plan', data.medicaid_plans.filter(function (p) { return p !== UNSPECIFIED_PLAN; }));
        fillSelect('f-cost', data.costs, function (c) { return COST_LABELS[c] || c; });
        fillSelect('f-age', data.age_groups);
        buildWordIndex();
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
