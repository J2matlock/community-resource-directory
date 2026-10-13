// Correction form: sends the listing name and the correction as JSON and
// shows any problems next to the right field. All messages are set with
// textContent. No name or contact details are asked for.

(function () {
  'use strict';

  var form = document.getElementById('request-form');
  var summary = document.getElementById('form-summary');
  var sending = document.getElementById('sending');
  var submit = document.getElementById('submit');
  var loadedAt = Date.now();

  function value(name) {
    var el = form.elements[name];
    return el ? el.value : '';
  }

  function supportText() {
    var a = document.getElementById('support-email');
    return a && a.textContent ? ' You can also email ' + a.textContent + '.' : '';
  }

  function controlsOf(wrap) {
    return wrap ? wrap.querySelectorAll('input:not([type="hidden"]), textarea, select') : [];
  }

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('[data-field]'), function (f) {
      f.classList.remove('invalid');
      Array.prototype.forEach.call(controlsOf(f), function (c) { c.removeAttribute('aria-invalid'); });
      var err = f.querySelector('.error-text');
      if (err) { err.hidden = true; err.textContent = ''; }
    });
    summary.hidden = true;
    while (summary.firstChild) summary.removeChild(summary.firstChild);
  }

  function showErrors(message, errors) {
    var list = document.createElement('ul');
    Object.keys(errors || {}).forEach(function (field) {
      var wrap = form.querySelector('[data-field="' + field + '"]');
      var label = wrap ? (wrap.querySelector('label, legend') || {}).textContent : '';
      var first = null;
      if (wrap) {
        wrap.classList.add('invalid');
        var err = wrap.querySelector('.error-text');
        if (err) { err.textContent = errors[field]; err.hidden = false; }
        Array.prototype.forEach.call(controlsOf(wrap), function (c) {
          c.setAttribute('aria-invalid', 'true');
          if (!first) first = c;
        });
      }
      var text = (label ? label.replace(/\s*\(required\)\s*/, '').replace(/\s+/g, ' ').trim() + ': ' : '') + errors[field];
      var li = document.createElement('li');
      if (first) {
        var a = document.createElement('a');
        a.href = '#' + first.id;
        a.textContent = text;
        a.addEventListener('click', function (e) { e.preventDefault(); first.focus(); });
        li.appendChild(a);
      } else {
        li.textContent = text;
      }
      list.appendChild(li);
    });
    var p = document.createElement('p');
    p.textContent = message;
    summary.appendChild(p);
    if (list.children.length) summary.appendChild(list);
    summary.hidden = false;
    summary.focus();
  }

  // A "Report a change" link like /request?type=correction&listing=Name&id=x
  // fills in which listing it is.
  try {
    var params = new URLSearchParams(location.search);
    var name = (params.get('listing') || '').slice(0, 150);
    var id = (params.get('id') || '').replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (name) form.elements.organization.value = (name + (id ? ' [listing: ' + id + ']' : '')).slice(0, 200);
  } catch (err) { /* old browser: the form still works */ }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
    var body = {
      request_type: 'correction',
      organization: value('organization'),
      correction: value('correction'),
      nickname: value('nickname'),
      turnstile_token: tokenInput ? tokenInput.value : '',
    };
    // Quick checks here first, so people see helpful messages right away.
    // The server checks everything again.
    var missing = {};
    ['organization', 'correction'].forEach(function (f) {
      if (!body[f].trim()) missing[f] = 'Please fill this in.';
    });
    if (Object.keys(missing).length) { showErrors('Please check the highlighted answers.', missing); return; }
    if (!body.turnstile_token) {
      var waited = (Date.now() - loadedAt) / 1000;
      showErrors(waited < 15
        ? 'The "are you human" check is still loading. Please wait a moment, then press Send again.'
        : 'The "are you human" check didn\'t load. A content blocker or a work network may be blocking it. Please try another browser, or your phone\'s data instead of Wi-Fi.' + supportText(), {});
      return;
    }
    submit.disabled = true;
    sending.textContent = 'Sending…';
    fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; });
      })
      .then(function (r) {
        if (r.res.ok) { location.href = '/request-thanks'; return; }
        sending.textContent = '';
        submit.disabled = false;
        if (window.turnstile) { try { window.turnstile.reset(); } catch (err) { /* ignore */ } }
        var msg = r.data.error || 'Something went wrong. Please try again.';
        if (r.res.status === 429 || r.res.status === 503) msg += supportText();
        showErrors(msg, r.data.errors);
      })
      .catch(function () {
        sending.textContent = '';
        submit.disabled = false;
        showErrors('Could not send. Please check your connection and try again.', {});
      });
  });
})();
