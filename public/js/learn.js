// Learn page: plain-language answers with sources, loaded from
// /content/learn.json. Search filters as you type; a link like
// /learn#medicare opens that answer. All text is set with textContent.

(function () {
  'use strict';

  var list = document.getElementById('learn-list');
  var toc = document.getElementById('learn-toc');
  var search = document.getElementById('learn-search');
  var count = document.getElementById('learn-count');
  var entries = [];

  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function safeUrl(u) {
    try { var url = new URL(u); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch (e) { return null; }
  }

  function render(data) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var tocList = el('ul');
    data.sections.forEach(function (section, si) {
      var sid = 'section-' + si;
      tocList.appendChild(el('li', {}, el('a', { href: '#' + sid }, section.title)));
      var wrap = el('section', { class: 'learn-section', id: sid, 'aria-labelledby': sid + '-h' }, el('h2', { id: sid + '-h' }, section.title));
      section.entries.forEach(function (e) {
        var body = el('div', { class: 'qa-body' });
        (e.a || []).forEach(function (p) { body.appendChild(el('p', {}, p)); });
        var srcs = (e.sources || []).map(function (s) {
          var href = safeUrl(s.url);
          return href ? el('li', {}, el('a', { href: href, rel: 'noopener' }, s.label || href)) : null;
        }).filter(Boolean);
        if (srcs.length) {
          var ul = el('ul');
          srcs.forEach(function (li) { ul.appendChild(li); });
          body.appendChild(el('div', { class: 'sources' }, el('p', {}, 'Sources:'), ul));
        }
        var details = el('details', { class: 'qa', id: e.id }, el('summary', {}, e.q), body);
        wrap.appendChild(details);
        entries.push({ node: details, section: wrap, text: [e.q, (e.a || []).join(' '), e.keywords || ''].join(' ').toLowerCase() });
      });
      list.appendChild(wrap);
    });
    toc.appendChild(tocList);
    if (data.updated) list.appendChild(el('p', { class: 'note' }, 'Last reviewed: ' + data.updated + '. Rules and amounts change; check the linked source.'));
    openFromHash();
    filter();
  }

  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var target = document.getElementById(id);
    if (target && target.tagName === 'DETAILS') {
      target.open = true;
      var summary = target.querySelector('summary');
      target.scrollIntoView();
      if (summary) summary.focus();
    }
  }

  function filter() {
    var words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    entries.forEach(function (e) {
      var match = words.every(function (w) { return e.text.indexOf(w) !== -1; });
      e.node.hidden = !match;
      if (match) shown++;
      if (words.length) e.node.open = match;
    });
    Array.prototype.forEach.call(list.querySelectorAll('.learn-section'), function (s) {
      s.hidden = !s.querySelector('details.qa:not([hidden])');
    });
    toc.hidden = words.length > 0;
    while (count.firstChild) count.removeChild(count.firstChild);
    if (!entries.length) { count.textContent = 'Answers are being added. Please check back soon.'; toc.hidden = true; return; }
    if (words.length && !shown) {
      count.appendChild(document.createTextNode('No answers match. Try another word, or call '));
      count.appendChild(el('a', { href: 'tel:211' }, '211'));
      count.appendChild(document.createTextNode('.'));
      return;
    }
    count.textContent = words.length ? shown + (shown === 1 ? ' answer matches.' : ' answers match.') : entries.length + ' answers. Tap a question to open it.';
  }

  search.addEventListener('input', filter);
  document.getElementById('learn-search-form').addEventListener('submit', function (e) { e.preventDefault(); filter(); });
  window.addEventListener('hashchange', openFromHash);

  fetch('/content/learn.json', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(function () { list.textContent = 'Sorry, the answers could not be loaded. Please try again later, or call 211.'; });
})();
