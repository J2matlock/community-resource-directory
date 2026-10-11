// Draws Cloudflare's "are you human" check. On narrow phones it uses the
// official compact size so it fits without sideways scrolling.
window.renderTurnstile = function () {
  if (!window.turnstile) return;
  Array.prototype.forEach.call(document.querySelectorAll('.cf-turnstile'), function (el) {
    window.turnstile.render(el, {
      sitekey: el.getAttribute('data-sitekey'),
      action: el.getAttribute('data-action') || undefined,
      size: window.innerWidth < 380 ? 'compact' : 'flexible',
    });
  });
};
