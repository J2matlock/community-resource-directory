// The red crisis bar every public page carries, built from src/region.js.
// Two callers share it so the markup can never drift apart:
// scripts/apply-region.mjs writes it into the HTML files, and
// src/routes/error-pages.js builds it into the 404, 403 and 500 pages.
// (The pause page, src/routes/paused.js, keeps its own simpler list.)

/**
 * Escapes text for HTML content or a double-quoted attribute. An apostrophe
 * is safe in both, so it is left alone: the pages must stay byte-identical.
 */
export const escapeAttrText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The crisis bar as HTML, indented to sit at the top of <body>. */
export function crisisBarHtml(REGION) {
  const esc = escapeAttrText;
  const groups = REGION.crisis.map((g) => {
    const items = g.items.map((it) => {
      const cls = it.wide ? (it.note ? ' class="wide-only crisis-note"' : ' class="wide-only"') : '';
      if (it.note) return `        <li${cls}>${esc(it.note)}</li>`;
      const sr = it.srPrefix ? `<span class="visually-hidden">${esc(it.srPrefix)}</span>` : '';
      return `        <li${cls}><a href="${esc(it.href)}">${sr}<strong>${esc(it.number)}</strong> ${esc(it.label)}</a></li>`;
    }).join('\n');
    // Three or more numbers shown on phones sit three to a row; fewer, two.
    const phoneCount = g.items.filter((it) => !it.wide).length;
    const layout = phoneCount >= 3 ? 'three' : 'two';
    return `    <div class="crisis-group">
      <p class="crisis-title">${esc(g.title)}</p>
      <ul class="crisis-list ${layout}">
${items}
      </ul>
    </div>`;
  }).join('\n');
  return `<aside class="crisis" aria-label="Crisis help">\n${groups}\n  </aside>`;
}
