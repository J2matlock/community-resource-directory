// Neutral addresses for sensitive listings (domestic violence): the page
// address shows up in browser history, shared links and QR codes, so it must
// not spell out the program's name. "catholic-charities-domestic-violence-program"
// becomes something like "h-1k2j3h4". Same formula in public/js/directory.js.

export function neutralId(id) {
  let h = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h-${h.toString(36)}`;
}
