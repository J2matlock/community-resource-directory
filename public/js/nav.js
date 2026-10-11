// On phones the main menu is one row you can swipe. Show the current page's
// item without making the whole page jump.
(function () {
  var cur = document.querySelector('.site-nav [aria-current="page"]');
  var row = cur && cur.closest('ul');
  if (row && row.scrollWidth > row.clientWidth) {
    row.scrollLeft = cur.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
  }
})();
