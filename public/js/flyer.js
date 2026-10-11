// Printable flyer: draws the QR codes and turns on the Print button.
// The site address comes from <body data-domain>, which `npm run apply-region`
// keeps in step with src/region.js.
(function () {
  var domain = document.body.getAttribute('data-domain') || location.host;
  var name = document.body.getAttribute('data-site-name') || '';
  var url = 'https://' + domain;

  // Keep the printed address and tear-off strips in step with the settings.
  document.querySelectorAll('.flyer-url').forEach(function (el) { el.textContent = domain; });
  document.querySelectorAll('.strip-text').forEach(function (el) {
    var strong = document.createElement('strong');
    strong.textContent = name;
    el.replaceChildren(strong, document.createTextNode(' ' + domain));
  });

  if (window.QR) {
    document.querySelectorAll('[data-qr]').forEach(function (slot) {
      // The big code is announced once; the repeated strip codes are hidden
      // from screen readers (their strips already are).
      var main = slot.getAttribute('data-qr') === 'main';
      slot.replaceChildren(window.QR.svg(url, { label: main ? 'QR code that opens ' + domain : '' }));
    });
  }

  var button = document.getElementById('print-flyer');
  if (button && typeof window.print === 'function') {
    button.hidden = false;
    button.addEventListener('click', function () { window.print(); });
  }
})();
