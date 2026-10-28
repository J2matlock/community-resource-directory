// On phones the main menu is one row you can swipe. Show the current page's
// item without making the whole page jump.
(function () {
  var cur = document.querySelector('.site-nav [aria-current="page"]');
  var row = cur && cur.closest('ul');
  if (row && row.scrollWidth > row.clientWidth) {
    row.scrollLeft = cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
  }
})();

// Save a copy of the public directory on this device, so it opens and searches
// with a weak or no signal (see /sw.js; never the admin panel). Started a few
// seconds after the page has loaded, so saving the copy never slows the first
// visit down on a weak signal.
(function () {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  function registerOffline() {
    setTimeout(function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* optional; the site works without it */ });
    }, navigator.serviceWorker.controller ? 0 : 3000);
  }
  if (document.readyState === 'complete') registerOffline();
  else window.addEventListener('load', registerOffline);
})();
