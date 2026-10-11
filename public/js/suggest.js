// "Don't see the help you need?" form: anonymous, sent to the site owner only.
// All text is set with textContent.

(function () {
  'use strict';

  var form = document.getElementById('suggest-form');
  var msg = document.getElementById('suggest-summary');
  var status = document.getElementById('suggest-status');
  var submit = document.getElementById('suggest-submit');

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.error-text'), function (e) { e.hidden = true; e.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (e) { e.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.invalid'), function (e) { e.classList.remove('invalid'); });
    msg.hidden = true; msg.textContent = '';
  }

  // Shows the message, marks each field with a problem, and moves focus to
  // the first one (its label, hint and error are read out with it).
  function showErrors(message, errors) {
    var first = null;
    Object.keys(errors || {}).forEach(function (f) {
      var err = document.getElementById(f + '-err');
      if (err) { err.textContent = errors[f]; err.hidden = false; }
      var ctl = form.elements[f];
      if (ctl && ctl.setAttribute) { ctl.setAttribute('aria-invalid', 'true'); if (!first) first = ctl; }
      var wrap = form.querySelector('[data-field="' + f + '"]');
      if (wrap) wrap.classList.add('invalid');
    });
    msg.textContent = message; msg.hidden = false;
    (first || msg).focus();
  }

  var waits = 0;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var tokenInput = form.querySelector('[name="cf-turnstile-response"]');
    var body = {
      looking_for: form.elements.looking_for.value, county: form.elements.county.value,
      nickname: form.elements.nickname.value, turnstile_token: tokenInput ? tokenInput.value : '',
    };
    if (body.looking_for.trim().length < 3) { showErrors('Please check the answer below.', { looking_for: 'Please tell us what kind of help you were looking for.' }); return; }
    if (!body.turnstile_token) {
      waits++;
      showErrors('The "are you human" check is still loading. Please wait a moment and try again.' + (waits > 1 ? ' If this keeps happening, ' + (document.body.dataset.fallback || 'call 211') + ' for help.' : ''), {});
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending…';
    fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
      .then(function (x) {
        submit.disabled = false;
        if (window.turnstile) { try { window.turnstile.reset(); } catch (err) { /* ignore */ } }
        if (x.r.ok) {
          form.reset();
          status.textContent = 'Thank you. Your message was sent anonymously.';
          status.focus();
          return;
        }
        status.textContent = '';
        showErrors(x.d.error || 'Something went wrong. Please try again.', x.d.errors);
      })
      .catch(function () { submit.disabled = false; status.textContent = ''; showErrors('Could not send. Please check your connection and try again.', {}); });
  });
})();
