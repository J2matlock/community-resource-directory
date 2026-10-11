// "Leave this site" quick exit, shown on domestic-violence searches, listings
// and safety answers. Pressing the button, or Esc twice, swaps this page for a
// weather page in the same tab and replaces it in the tab's history, so Back
// doesn't come straight here. It can't erase history from earlier pages; the
// Learn answer "How can I use this site safely?" explains that honestly.
// Also: forgetThisDevice() removes everything this site saved on the device.

(function () {
  'use strict';

  var EXIT_TO = 'https://www.weather.gov/';
  var button = null;
  var lastEsc = 0;
  var shownAt = 0; // Esc twice keeps working briefly after the button hides (the first Esc may clear a search)

  function leave() {
    try { document.body.textContent = ''; } catch (e) { /* ignore */ }
    window.location.replace(EXIT_TO);
  }

  function ensureButton() {
    if (button) return button;
    button = document.createElement('a');
    button.href = EXIT_TO;
    button.id = 'quick-exit';
    button.className = 'quick-exit';
    button.textContent = 'Leave this site';
    var hint = document.createElement('span');
    hint.className = 'visually-hidden';
    hint.textContent = ' (opens a weather page; or press Escape twice)';
    button.appendChild(hint);
    button.hidden = true;
    button.addEventListener('click', function (e) { e.preventDefault(); leave(); });
    // First in keyboard order, so it is one Tab away; it is drawn fixed on screen.
    document.body.insertBefore(button, document.body.firstChild);
    return button;
  }

  function show(on) {
    ensureButton().hidden = !on;
    if (on) shownAt = Date.now();
    document.body.classList.toggle('has-quick-exit', !!on);
  }

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !button) return;
    var now = Date.now();
    if (button.hidden && now - shownAt > 10000) return;
    if (now - lastEsc < 1500) leave();
    lastEsc = now;
  }, true);

  // Removes this site's saved copy, handout list and settings from this device.
  function forgetThisDevice() {
    var jobs = [];
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); }));
    }
    return Promise.all(jobs).catch(function () { /* best effort */ });
  }

  window.SADKSafety = { show: show, leave: leave, forgetThisDevice: forgetThisDevice };
})();
