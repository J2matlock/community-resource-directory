// Provider request form: sends the answers as JSON and shows any problems
// next to the right field. All messages are set with textContent.

(function () {
  'use strict';

  var form = document.getElementById('request-form');
  var summary = document.getElementById('form-summary');
  var sending = document.getElementById('sending');
  var submit = document.getElementById('submit');
  var loadedAt = Date.now();

  function checked(name) {
    return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; });
  }

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
          if (c.type === 'checkbox' && field === 'address' && c.id === 'no_public_address') return;
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

  // New program vs correction to an existing listing. A link like
  // /request?type=correction&listing=Name opens the form ready for a correction.
  function isCorrection() {
    var r = form.querySelector('input[name="request_type"]:checked');
    return r && r.value === 'correction';
  }
  function applyType() {
    var c = isCorrection();
    document.getElementById('correction-field').hidden = !c;
    document.getElementById('ok-field').hidden = c;
    document.getElementById('services-req').hidden = c;
    document.getElementById('services').required = !c;
    document.getElementById('contact-hint').hidden = c;
    document.getElementById('program-heading').textContent = c ? 'Which listing, and what should it say?' : 'About the program';
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="request_type"]'), function (r) {
    r.addEventListener('change', applyType);
  });
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('type') === 'correction') {
      form.querySelector('input[name="request_type"][value="correction"]').checked = true;
      var name = (params.get('listing') || '').slice(0, 150);
      var id = (params.get('id') || '').replace(/[^a-z0-9-]/g, '').slice(0, 80);
      if (name) form.elements.organization.value = name + (id ? ' [listing: ' + id + ']' : '');
    }
  } catch (err) { /* old browser: the form still works */ }
  applyType();

  document.getElementById('no_public_address').addEventListener('change', function (e) {
    document.getElementById('address').disabled = e.target.checked;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
    var body = {
      request_type: isCorrection() ? 'correction' : 'new', correction: value('correction'),
      organization: value('organization'), services: value('services'), eligibility: value('eligibility'),
      age_groups: checked('age_groups'), cost: checked('cost'), medicaid: value('medicaid'), counties: checked('counties'),
      address: value('address'), no_public_address: document.getElementById('no_public_address').checked,
      office_not_shelter: document.getElementById('office_not_shelter').checked,
      hours: value('hours'), phone: value('phone'), email: value('email'), website: value('website'),
      how_to_start: value('how_to_start'), submitter_name: value('submitter_name'), submitter_contact: value('submitter_contact'),
      ok_to_publish: document.getElementById('ok_to_publish').checked,
      nickname: value('nickname'),
      turnstile_token: tokenInput ? tokenInput.value : '',
    };
    // Quick checks here first, so people see helpful messages right away.
    // The server checks everything again.
    var missing = {};
    var needed = isCorrection() ? ['organization', 'correction', 'submitter_name', 'submitter_contact'] : ['organization', 'services', 'submitter_name', 'submitter_contact'];
    needed.forEach(function (f) {
      if (!body[f].trim()) missing[f] = 'Please fill this in.';
    });
    if (!isCorrection()) {
      if (!body.phone.trim() && !body.email.trim() && !body.website.trim()) missing.phone = 'Please give at least a phone, email or website for the program.';
      if (!body.ok_to_publish) missing.ok_to_publish = 'Please tick the box to confirm the program details can be published.';
    }
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
