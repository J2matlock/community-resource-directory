// On the "paused" page: remove this site's offline copy from the device, so an
// old saved directory doesn't keep showing while the site is paused.
(function () {
  'use strict';
  try {
    if (window.caches && caches.keys) caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k); }); });
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (regs) { regs.forEach(function (r) { r.unregister(); }); });
    }
  } catch (e) { /* best effort */ }
})();
