// Ways to help: links straight to each organization's own donation and
// volunteer pages, loaded from /content/help.json. This site never collects
// money. All text is set with textContent.

(function () {
  'use strict';

  var list = document.getElementById('help-list');
  var filterBox = document.getElementById('help-filter');
  var cards = [];

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

  function link(u, label, cls, who) {
    var href = safeUrl(u);
    if (!href) return null;
    var a = el('a', { href: href, rel: 'noopener' }, label);
    if (cls) a.className = cls;
    a.appendChild(el('span', { class: 'visually-hidden' }, ': ' + who));
    return a;
  }

  function render(data) {
    while (list.firstChild) list.removeChild(list.firstChild);
    (data.orgs || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (o) {
      var links = el('div', { class: 'help-links' },
        link(o.donate_url, 'Donate', 'primary', o.name),
        link(o.volunteer_url, 'Volunteer', '', o.name),
        link(o.wishlist_url, 'Items they need', '', o.name),
        o.listing_id ? el('a', { href: '/listing/' + encodeURIComponent(o.listing_id) }, 'Their listing', el('span', { class: 'visually-hidden' }, ': ' + o.name)) : null);
      var card = el('article', { class: 'help-org' }, el('h2', {}, o.name), o.what_it_funds ? el('p', {}, o.what_it_funds) : null, links);
      cards.push({ node: card, text: [o.name, o.town || '', o.what_it_funds || ''].join(' ').toLowerCase() });
      list.appendChild(card);
    });
    if ((data.no_online_page || []).length) {
      var ul = el('ul');
      data.no_online_page.forEach(function (o) { ul.appendChild(el('li', {}, el('strong', {}, o.name), o.how ? ': ' + o.how : '')); });
      list.appendChild(el('section', {}, el('h2', {}, 'No online giving page'), el('p', {}, 'These programs welcome help in person. Call ahead to ask what they need.'), ul));
    }
    if (!cards.length) list.appendChild(el('p', {}, 'The list of organizations is being put together. Please check back soon.'));
    applyFilter();
  }

  var countLine = document.getElementById('help-count');
  function applyFilter() {
    var words = filterBox.value.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    cards.forEach(function (c) { var ok = words.every(function (w) { return c.text.indexOf(w) !== -1; }); c.node.hidden = !ok; if (ok) shown++; });
    countLine.textContent = !cards.length ? '' : shown ? 'Showing ' + shown + ' of ' + cards.length + ' organizations.' : 'No organizations match. Try another word.';
  }
  filterBox.addEventListener('input', applyFilter);

  fetch('/content/help.json', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(function () { list.textContent = 'Sorry, the list could not be loaded. Please try again later.'; });
})();
