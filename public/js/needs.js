// Community needs page: documented gaps (from /content/needs.json), public
// totals of anonymous barrier reports (any count under 5 is hidden by the
// server), and the anonymous report form. All text is set with textContent.

(function () {
  'use strict';

  var form = document.getElementById('barrier-form');
  var options = document.getElementById('barrier-options');
  var totals = document.getElementById('barrier-totals');
  var gaps = document.getElementById('gaps-list');
  var msg = document.getElementById('barrier-summary-msg');
  var status = document.getElementById('barrier-status');
  var submit = document.getElementById('barrier-submit');
  var COUNTIES = [];

  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  function safeUrl(u) {
    try { var url = new URL(u); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch (e) { return null; }
  }

  function shown(n, min) { return n == null ? 'fewer than ' + min : String(n); }

  function renderSummary(s) {
    if (!COUNTIES.length && s.barriers.length) {
      var all = Object.keys(s.barriers[0].by_county);
      COUNTIES = all.filter(function (c) { return !/^Other/.test(c); });
      // The county choices are written into the page itself, so the form works
      // even when the totals fail to load. An old cached page may still have
      // only the "Choose…" line; fill it from the totals in that case.
      var sel = form.elements.county;
      if (sel.options.length <= 1) all.forEach(function (c) { sel.appendChild(el('option', {}, c)); });
    }
    while (totals.firstChild) totals.removeChild(totals.firstChild);
    if (s.reports == null) {
      totals.appendChild(el('p', {}, 'Not enough reports yet to share totals. Totals appear once there are at least ' + s.min_shown + ', and are updated once a day.'));
      return;
    }
    var rows = s.barriers.filter(function (b) { return b.count != null; }).sort(function (a, b) { return b.count - a.count; });
    totals.appendChild(el('p', {}, s.reports + '+ anonymous reports so far (updated daily). To protect privacy, numbers are rounded down to a multiple of ' + s.min_shown + ' and anything under ' + s.min_shown + ' is hidden.'));
    if (!rows.length) return;
    var head = el('tr', {}, el('th', { scope: 'col' }, 'Barrier'), el('th', { scope: 'col', class: 'num' }, 'Reports'));
    COUNTIES.forEach(function (c) { head.appendChild(el('th', { scope: 'col', class: 'num' }, c)); });
    var tbody = el('tbody');
    rows.forEach(function (b) {
      var tr = el('tr', {}, el('th', { scope: 'row' }, b.label), el('td', { class: 'num' }, b.count + '+'));
      COUNTIES.forEach(function (c) {
        tr.appendChild(el('td', { class: 'num' }, b.by_county[c] == null ? el('span', {}, el('span', { 'aria-hidden': 'true' }, '–'), el('span', { class: 'visually-hidden' }, 'fewer than ' + s.min_shown)) : b.by_county[c] + '+'));
      });
      tbody.appendChild(tr);
    });
    totals.appendChild(el('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Barrier reports by county (scrolls sideways)' }, el('table', { class: 'totals' }, el('caption', { class: 'visually-hidden' }, 'Barrier reports by county'), el('thead', {}, head), tbody)));
    totals.appendChild(el('p', { class: 'note' }, '"–" means ' + shown(null, s.min_shown) + ' (hidden). "10+" means 10 to 14.'));
  }

  function renderGaps(data) {
    while (gaps.firstChild) gaps.removeChild(gaps.firstChild);
    var intro = document.getElementById('needs-intro');
    if (data.intro) intro.textContent = data.intro;
    var introSrc = el('ul');
    (data.intro_sources || []).forEach(function (s) { var href = safeUrl(s.url); if (href) introSrc.appendChild(el('li', {}, el('a', { href: href, rel: 'noopener' }, s.label || href))); });
    if (introSrc.firstChild && !document.getElementById('needs-intro-sources')) intro.parentNode.insertBefore(el('div', { class: 'sources', id: 'needs-intro-sources' }, el('p', {}, 'Sources:'), introSrc), intro.nextSibling);
    (data.gaps || []).forEach(function (g) {
      var box = el('section', { class: 'gap', id: g.id, 'aria-labelledby': g.id + '-h' }, el('h3', { id: g.id + '-h' }, g.title));
      if (g.summary) box.appendChild(el('p', {}, el('strong', {}, g.summary)));
      (g.paragraphs || []).forEach(function (p) { box.appendChild(el('p', {}, p)); });
      if ((g.what_would_help || []).length) {
        var ul = el('ul');
        g.what_would_help.forEach(function (h) { ul.appendChild(el('li', {}, h)); });
        box.appendChild(el('p', {}, el('strong', {}, 'What would help:')));
        box.appendChild(ul);
      }
      var src = el('ul');
      (g.sources || []).forEach(function (s) { var href = safeUrl(s.url); if (href) src.appendChild(el('li', {}, el('a', { href: href, rel: 'noopener' }, s.label || href))); });
      if (src.firstChild) box.appendChild(el('div', { class: 'sources' }, el('p', {}, 'Sources:'), src));
      gaps.appendChild(box);
    });
    if (data.updated) gaps.appendChild(el('p', { class: 'note' }, 'Last reviewed: ' + data.updated + '.'));
  }

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.error-text'), function (e) { e.hidden = true; e.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (e) { e.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.invalid'), function (e) { e.classList.remove('invalid'); });
    msg.hidden = true; msg.textContent = '';
  }

  function showErrors(message, errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (f) {
      var err = document.getElementById(f + '-err');
      if (err) { err.textContent = errors[f]; err.hidden = false; }
      var ctl = f === 'barriers' ? options.querySelector('input') : form.elements[f];
      if (ctl && ctl.setAttribute) { ctl.setAttribute('aria-invalid', 'true'); if (!first) first = ctl; }
      var wrap = form.querySelector('[data-field="' + f + '"]');
      if (wrap) wrap.classList.add('invalid');
    });
    msg.textContent = message; msg.hidden = false; msg.focus();
  }

  function loadSummary() {
    return fetch('/api/barriers/summary', { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(renderSummary)
      .catch(function () { totals.textContent = 'Totals could not be loaded right now.'; });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var picked = Array.prototype.map.call(options.querySelectorAll('input:checked'), function (i) { return i.value; });
    var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
    var body = {
      barriers: picked, county: form.elements.county.value, reporter: form.elements.reporter.value,
      nickname: form.elements.nickname.value,
      turnstile_token: tokenInput ? tokenInput.value : '',
    };
    var missing = {};
    if (!picked.length) missing.barriers = 'Please tick at least one barrier.';
    if (!body.county) missing.county = 'Please choose a county.';
    if (Object.keys(missing).length) { showErrors('Please check the highlighted answers.', missing); return; }
    if (!body.turnstile_token) { showErrors('The "are you human" check is still loading. Please wait a moment and try again.', {}); return; }
    submit.disabled = true;
    status.textContent = 'Sending…';
    fetch('/api/barriers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
      .then(function (x) {
        submit.disabled = false;
        if (window.turnstile) { try { window.turnstile.reset(); } catch (err) { /* ignore */ } }
        if (x.r.ok) {
          form.reset();
          status.textContent = 'Thank you. Your report was sent anonymously.';
          loadSummary();
          return;
        }
        status.textContent = '';
        showErrors(x.d.error || 'Something went wrong. Please try again.', x.d.errors);
      })
      .catch(function () { submit.disabled = false; status.textContent = ''; showErrors('Could not send. Please check your connection and try again.', {}); });
  });

  loadSummary();
  fetch('/content/needs.json', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(renderGaps)
    .catch(function () { gaps.textContent = 'This section could not be loaded right now.'; });
})();
