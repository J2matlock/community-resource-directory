// Admin panel. Every value from the database or the provider form is shown
// with textContent or input.value, never as HTML (rule 5).

let COUNTIES = ['Regional']; // filled from the server's region settings
const AGE_GROUPS = ['Children', 'Youth 16–24', 'Adults', 'Seniors'];
const COSTS = ['Free', 'Sliding scale', 'Insurance', 'Uninsured OK', 'Private pay'];
const STATUSES = ['Active', 'Temporarily closed', 'Seasonal'];

const main = document.getElementById('main');
let lists = { categories: [], plans: [] };
let dirty = false;
// The edit form's "keep the draft now" function while a save of it is waiting.
let pendingDraft = null;
// Counts page changes, so a late input event from a form that is being left
// (the browser fires "change" when focus moves to a dialog) is ignored.
let viewGen = 0;

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = Boolean(v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false || c === '') continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Every failure ends up as one plain message. An expired Cloudflare login
// usually shows up as a failed request (the login page is on another site),
// or as a page instead of data: both say to reload. Typed changes to a
// listing are kept on this device (see "drafts" below), so reloading is safe.
const MSG_OFFLINE = 'Couldn\'t reach the site. Check your connection and try again. If you\'ve been away a while, your login may have expired: reload the page to log in again.';
const MSG_LOGIN = 'Your login has expired. Reload the page to log in again.';
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw Object.assign(new Error(MSG_OFFLINE), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(MSG_LOGIN), { status: res.status });
  if (!res.ok) throw Object.assign(new Error(data?.error || `Something went wrong on the site (error ${res.status}). Please try again in a minute.`), { status: res.status, data });
  // A page instead of data (a login page or a Wi-Fi sign-in page): nothing was saved.
  if (!data || typeof data !== 'object') throw Object.assign(new Error(MSG_LOGIN), { status: 401 });
  return data;
}

function toast(message, { long = false } = {}) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), long ? 9000 : 3500);
}

// Runs a button's action. If it fails (expired login, no signal), the button
// comes back and the reason shows next to it and is read out.
async function runAction(button, fn) {
  button.disabled = true;
  const old = button.parentNode?.querySelector(':scope > .action-error');
  old?.remove();
  try {
    await fn();
  } catch (err) {
    button.disabled = false;
    button.after(el('p', { class: 'action-error', role: 'alert' }, err.message || 'That did not work. Please try again.'));
  }
}

// Replaces the page. A new page starts at the top with focus on <main>.
function show(...nodes) {
  main.replaceChildren(...nodes.flat().filter(Boolean));
  main.focus();
}

// Replaces the page but keeps the owner's place: same scroll position, and
// focus on the element matching `focus` (a CSS selector, e.g. the button they
// pressed) instead of jumping to the top. Used after Save, Verified today,
// Retire, Restore and Mark handled.
function showKeepingPlace({ focus }, ...nodes) {
  const top = window.scrollY;
  main.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo(0, top);
  const target = focus ? main.querySelector(focus) : null;
  if (target) target.focus({ preventScroll: true }); else main.focus({ preventScroll: true });
}

function showError(err) {
  const missing = err.status === 404;
  show(el('div', { class: 'error-page', role: 'alert' },
    el('h1', {}, missing ? 'Not found' : 'Something went wrong'),
    el('p', {}, missing ? 'That listing or page doesn\'t exist. It may have been removed, or the link is wrong.' : err.message),
    el('p', {}, missing
      ? el('a', { class: 'button', href: '#/listings' }, 'Go to all listings')
      : el('button', { type: 'button', onclick: () => location.reload() }, 'Reload'))));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Today's date where the owner works (upstate NY), as YYYY-MM-DD. The server
// uses the same zone, so a re-check never looks due a day early in the evening.
function todayLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// A tap-to-call link, the same way the public site makes them: tel:+1 and the
// 10 digits, with an extension after a comma; short codes (211, 988) as they
// are. Anything else (a count, odd formatting) gets no link.
function telHref(phone) {
  const p = String(phone ?? '').trim();
  if (/^\d{3}$/.test(p)) return `tel:${p}`;
  const m = p.match(/^\((\d{3})\) (\d{3})-(\d{4})(?: x(\d+))?$/);
  if (!m) return null;
  return `tel:+1${m[1]}${m[2]}${m[3]}${m[4] ? `,${m[4]}` : ''}`;
}

function phoneLink(phone) {
  const href = telHref(phone);
  return href ? el('a', { class: 'item-phone', href }, phone) : null;
}

function badges(l) {
  return [
    l.visibility === 'Internal' ? el('span', { class: 'badge internal' }, 'Internal') : null,
    l.retired ? el('span', { class: 'badge retired' }, 'Retired') : null,
    l.status === 'Temporarily closed' ? el('span', { class: 'badge closed' }, 'Temporarily closed') : null,
    l.status === 'Seasonal' ? el('span', { class: 'badge seasonal' }, 'Seasonal') : null,
  ];
}

// Display only: when a listing was last checked and whether a re-check is due
// (the same date the "Due for re-check" view uses: the server works it out,
// 3 months for basic-needs and safety categories, 12 for the rest, or a
// re-check date that has passed). Words carry the meaning; colour only supports it.
function recheckDue(l) {
  return l.recheck_due || '';
}

function checkedWords(l) {
  if (l.last_verified) return `confirmed ${formatDate(l.last_verified)}`;
  if (l.last_checked_online) return `checked online ${formatDate(l.last_checked_online)}`;
  return 'never checked';
}

function verifiedState(l) {
  const today = todayLocal();
  if (l.review_by && l.review_by <= today) return el('span', { class: 'state state-due' }, `Re-check due (${formatDate(l.review_by)})`);
  const due = recheckDue(l);
  if (!due) return el('span', { class: 'state state-never' }, 'Not checked yet');
  if (due <= today) return el('span', { class: 'state state-due' }, `Re-check due · ${checkedWords(l)}`);
  return el('span', { class: `state ${l.last_verified ? 'state-ok' : 'state-never'}` }, l.last_verified ? `Confirmed ${formatDate(l.last_verified)}` : `Checked online ${formatDate(l.last_checked_online)} · not yet confirmed`);
}

function emptyState(title, text) {
  return el('div', { class: 'empty' }, el('p', { class: 'empty-title' }, title), text ? el('p', {}, text) : null);
}

function pageHead(title, ...extra) {
  return el('div', { class: 'page-head' }, el('h1', { tabindex: '-1' }, title), ...extra);
}

function setNav(name) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function loadLists() {
  const [c, p, r] = await Promise.all([api('/lists/categories'), api('/lists/plans'), api('/region')]);
  lists = { categories: c.items.map((i) => i.name), plans: p.items.map((i) => i.name) };
  COUNTIES = r.counties;
}

// ---------- Listings view ----------
let listingCache = [];
const listFilters = { q: '', retired: false, visibility: '', category: '' };
// Where the owner was in the list, so coming back from a listing lands on it
// again (with 400+ listings, starting over at the top on every edit is slow).
const listPlace = { y: 0, id: '' };

async function viewListings() {
  setNav('listings');
  document.title = 'Listings: Directory admin';
  const { listings } = await api('/listings');
  listingCache = listings;

  const results = el('ul', { class: 'items', 'aria-label': 'Listings' });
  const count = el('p', { class: 'count-line', role: 'status' });

  function render() {
    const q = listFilters.q.trim().toLowerCase();
    const shown = listingCache.filter((l) => {
      if (!listFilters.retired && l.retired) return false;
      if (listFilters.visibility && l.visibility !== listFilters.visibility) return false;
      if (listFilters.category && l.category !== listFilters.category) return false;
      if (!q) return true;
      return [l.name, l.organization, l.category, l.town, l.tags.join(' '), l.phone, l.private_notes].join(' ').toLowerCase().includes(q);
    });
    count.textContent = `${shown.length} of ${listingCache.length} listings`;
    results.replaceChildren(...shown.map((l) => el('li', { class: `item${l.retired ? ' is-retired' : ''}${l.visibility === 'Internal' ? ' is-internal' : ''}` },
      el('div', { class: 'item-main' },
        el('a', { class: 'item-name', href: `#/edit/${l.id}`, 'data-id': l.id, onclick: () => { listPlace.y = window.scrollY; listPlace.id = l.id; } }, l.name),
        el('p', { class: 'item-meta' }, [l.category, l.town].filter(Boolean).join(' · '))),
      el('div', { class: 'item-side' },
        el('span', { class: 'item-badges' }, badges(l)),
        verifiedState(l)),
    )));
    if (!shown.length) {
      results.append(el('li', { class: 'item-empty' }, emptyState('No listings match', 'Try fewer or different words, or change the filters above.')));
    }
  }

  const search = el('input', { type: 'search', id: 'list-search', 'aria-describedby': 'list-search-hint', value: listFilters.q, oninput: (e) => { listFilters.q = e.target.value; render(); } });
  const vis = el('select', { id: 'list-vis', onchange: (e) => { listFilters.visibility = e.target.value; render(); } },
    el('option', { value: '' }, 'Public and Internal'), el('option', { value: 'Public' }, 'Public only'), el('option', { value: 'Internal' }, 'Internal only'));
  vis.value = listFilters.visibility;
  const cat = el('select', { id: 'list-cat', onchange: (e) => { listFilters.category = e.target.value; render(); } },
    el('option', { value: '' }, 'All categories'), ...lists.categories.map((c) => el('option', { value: c }, c)));
  cat.value = listFilters.category;

  show(
    pageHead('Listings', el('a', { href: '#/new', class: 'button' }, '+ Add a listing')),
    el('div', { class: 'toolbar filter-panel' },
      el('div', { class: 'field field-search' }, el('label', { for: 'list-search' }, 'Search'),
        el('span', { class: 'hint', id: 'list-search-hint' }, 'Name, town, category, search words, phone or private notes.'), search),
      el('div', { class: 'field' }, el('label', { for: 'list-vis' }, 'Visibility'), vis),
      el('div', { class: 'field' }, el('label', { for: 'list-cat' }, 'Category'), cat),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: listFilters.retired, onchange: (e) => { listFilters.retired = e.target.checked; render(); } }), 'Show retired'),
    ),
    count,
    results,
  );
  render();
  if (listPlace.id) {
    const link = results.querySelector(`a[data-id="${CSS.escape(listPlace.id)}"]`);
    if (link) { window.scrollTo(0, listPlace.y); link.focus({ preventScroll: true }); }
    listPlace.id = '';
  }
}

// ---------- Edit / Add view ----------
const TEXT_FIELDS = [
  ['name', 'Name', 'text', 'Organization or program name. Required.'],
  ['organization', 'Parent organization', 'text', 'Groups programs from the same agency, e.g. "Open Door Mission".'],
];

// Sources as text in the form: one per line, "web address | what it shows | date seen".
function sourcesToText(list) {
  return (list || []).map((s) => [s.url, s.label, s.seen].filter(Boolean).join(' | ')).join('\n');
}
function textToSources(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [url = '', label = '', seen = ''] = line.split('|').map((p) => p.trim());
    return { url, label, seen };
  });
}

function textField(name, label, type, hint, value, opts = {}) {
  const id = `f-${name}`;
  const input = type === 'textarea'
    ? el('textarea', { id, name, rows: opts.rows ?? 4, 'aria-describedby': `${id}-hint ${id}-err` })
    : el('input', { id, name, type, 'aria-describedby': `${id}-hint ${id}-err`, autocomplete: 'off', 'aria-required': opts.required ? 'true' : null });
  input.value = value ?? '';
  return el('div', { class: `field${opts.private ? ' private' : ''}`, 'data-field': name },
    el('label', { for: id }, label),
    hint ? el('span', { class: 'hint', id: `${id}-hint` }, hint) : null,
    input,
    el('p', { class: 'error-text', id: `${id}-err`, hidden: true }),
  );
}

function checkGroup(name, legend, options, selected, hint) {
  const id = `f-${name}`;
  return el('fieldset', { 'data-field': name, 'aria-describedby': hint ? `${id}-hint ${id}-err` : `${id}-err` },
    el('legend', {}, legend),
    hint ? el('p', { class: 'hint group-hint', id: `${id}-hint` }, hint) : null,
    el('div', { class: 'checks' }, ...options.map((o) => el('label', {},
      el('input', { type: 'checkbox', name, value: o, checked: selected.includes(o) }), o))),
    el('p', { class: 'error-text', id: `${id}-err`, hidden: true }),
  );
}

function selectField(name, label, options, value, hint) {
  const id = `f-${name}`;
  const sel = el('select', { id, name, 'aria-describedby': `${id}-hint ${id}-err`, 'aria-required': name === 'category' ? 'true' : null },
    ...options.map((o) => el('option', { value: o }, o || 'Choose a category…')));
  sel.value = value;
  return el('div', { class: 'field', 'data-field': name },
    el('label', { for: id }, label),
    hint ? el('span', { class: 'hint', id: `${id}-hint` }, hint) : null,
    sel,
    el('p', { class: 'error-text', id: `${id}-err`, hidden: true }));
}

function readForm(form) {
  const v = (n) => form.elements[n]?.value ?? '';
  const checked = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)].map((i) => i.value);
  return {
    name: v('name'), organization: v('organization'), category: v('category'),
    tags: v('tags').split(',').map((t) => t.trim()).filter(Boolean),
    phone: v('phone'), fax: v('fax'), email: v('email'), website: v('website'),
    address: v('address'), town: v('town'),
    serves_counties: checked('serves_counties'), hours: v('hours'), eligibility: v('eligibility'),
    age_groups: checked('age_groups'), cost: checked('cost'), medicaid_plans: checked('medicaid_plans'),
    medicaid_notes: v('medicaid_notes'), description: v('description'), private_notes: v('private_notes'),
    status: v('status'), review_by: v('review_by'), visibility: form.querySelector('input[name="visibility"]:checked')?.value ?? 'Public',
    last_verified: v('last_verified'),
    last_checked_online: v('last_checked_online'),
    sources: textToSources(v('sources')),
    confirm_office_address: form.elements.confirm_office_address?.checked === true,
  };
}

function clearErrors(form) {
  for (const f of form.querySelectorAll('[data-field]')) {
    f.classList.remove('invalid');
    for (const c of f.querySelectorAll('[aria-invalid]')) c.removeAttribute('aria-invalid');
    const err = f.querySelector('.error-text');
    if (err) { err.hidden = true; err.textContent = ''; }
  }
  form.querySelector('.summary')?.remove();
}

function showProblems(form, { errors = {}, warnings = [], error }, onSaveAnyway) {
  clearErrors(form);
  const items = [];
  for (const [field, msg] of Object.entries(errors)) {
    const wrap = form.querySelector(`[data-field="${field}"]`);
    if (wrap) {
      wrap.classList.add('invalid');
      for (const c of wrap.querySelectorAll('input, select, textarea')) c.setAttribute('aria-invalid', 'true');
      const err = wrap.querySelector('.error-text');
      err.textContent = msg;
      err.hidden = false;
    }
    const label = wrap?.querySelector('label, legend')?.firstChild?.textContent ?? field;
    items.push(el('li', {}, wrap ? el('a', { href: `#f-${field}`, onclick: (e) => { e.preventDefault(); (wrap.querySelector('input, select, textarea'))?.focus(); } }, `${label}: ${msg}`) : msg));
  }
  const isWarnOnly = !Object.keys(errors).length && warnings.length;
  const box = el('div', { class: `summary${isWarnOnly ? ' warn' : ''}`, tabindex: '-1', role: 'alert' },
    el('h2', {}, isWarnOnly ? 'Please check before saving' : 'Not saved yet'),
    error && !isWarnOnly ? el('p', {}, error) : null,
    items.length ? el('ul', {}, items) : null,
    warnings.length ? el('ul', {}, warnings.map((w) => el('li', {}, w))) : null,
    isWarnOnly ? el('p', {}, el('button', { type: 'button', onclick: onSaveAnyway }, 'Save anyway')) : null,
  );
  form.prepend(box);
  box.focus();
}

// ---------- Change history ----------
// Changes made in the same save are grouped into one card: when, who, then
// each field's Before and After. For longer text the words that changed are
// marked (struck through = removed, highlighted = added). Text only, no HTML.
const FIELD_LABELS = {
  name: 'Name', organization: 'Parent organization', category: 'Category', tags: 'Search words', phone: 'Phone',
  fax: 'Fax', email: 'Email', website: 'Website', address: 'Office address', town: 'Town', serves_counties: 'Counties served',
  hours: 'Hours', eligibility: 'Who can get help', age_groups: 'Age groups', cost: 'Cost', medicaid_plans: 'Insurance accepted',
  medicaid_notes: 'Insurance notes', description: 'Description (public)', private_notes: 'Private notes', status: 'Status',
  review_by: 'Re-check by', visibility: 'Visibility', last_verified: 'Last confirmed with the program', last_checked_online: 'Last checked online', sources: 'Sources', retired: 'Retired',
};

function whoChanged(by) {
  if (!by) return '';
  if (by.includes('@')) return 'by you';
  return `by ${by.replace(/\s+\d{4}-\d{2}-\d{2}$/, '')}`;
}

// Word-level differences (longest common subsequence). Returns
// [{ text, kind: 'same' | 'del' | 'ins' }]; null if the texts are too long.
function wordDiff(a, b) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  if (x.length * y.length > 400000) return null;
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (text, kind) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ text, kind }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push(x[i], 'same'); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { push(x[i], 'del'); i++; } else { push(y[j], 'ins'); j++; }
  }
  while (i < n) push(x[i++], 'del');
  while (j < m) push(y[j++], 'ins');
  // Mostly rewritten: marking nearly every word helps no one, so show plain text.
  const words = (k) => out.filter((o) => o.kind === k).reduce((t, o) => t + o.text.split(/\s+/).filter(Boolean).length, 0);
  if (words('same') < Math.max(words('del'), words('ins')) * 0.6) return null;
  return out;
}

function diffSide(parts, side) {
  const p = el('p', { class: 'change-text' });
  for (const part of parts) {
    if (part.kind === 'same') p.append(part.text);
    else if (part.kind === side) p.append(el(side, {}, el('span', { class: 'visually-hidden' }, side === 'del' ? ' [removed: ' : ' [added: '), part.text, el('span', { class: 'visually-hidden' }, '] ')));
  }
  return p;
}

function changeRow(h) {
  const label = FIELD_LABELS[h.field] || h.field.replace(/_/g, ' ');
  if (h.field === 'created') return el('li', { class: 'change' }, el('p', { class: 'change-field' }, 'Listing created'), el('p', { class: 'change-text' }, h.new_value || ''));
  const before = h.old_value ?? '', after = h.new_value ?? '';
  const long = before.length > 60 && after.length > 60;
  const parts = long ? wordDiff(before, after) : null;
  const col = (title, text, side) => el('div', { class: `change-col ${side}` },
    el('p', { class: 'change-label' }, title),
    parts ? diffSide(parts, side === 'before' ? 'del' : 'ins') : el('p', { class: 'change-text' }, text || '(empty)'));
  return el('li', { class: 'change' }, el('p', { class: 'change-field' }, label),
    el('div', { class: 'change-cols' }, col('Before', before, 'before'), col('After', after, 'after')));
}

function historyList(history) {
  const groups = [];
  for (const h of history) {
    const g = groups[groups.length - 1];
    if (g && g.at === h.changed_at && g.by === h.changed_by) g.rows.push(h);
    else groups.push({ at: h.changed_at, by: h.changed_by, rows: [h] });
  }
  return el('ol', { class: 'history-list' }, groups.map((g) => el('li', { class: 'history-save' },
    el('h3', {}, `${formatDateTime(g.at)} `, el('span', { class: 'who' }, whoChanged(g.by))),
    el('ul', { class: 'changes' }, g.rows.map(changeRow)))));
}

// `again` is set when the page is rebuilt after Save, Verified today, Retire or
// Restore: the scroll position is kept and focus goes to that button.
async function viewEdit(id, { prefill = null, fromRequest = null, okToPublish = false, again = null } = {}) {
  setNav('listings');
  let listing = null;
  let history = [];
  if (id) {
    const data = await api(`/listings/${encodeURIComponent(id)}`);
    listing = data.listing;
    history = data.history;
  }
  const l = listing ?? {
    // No category until the owner picks one: a pre-filled one could put a
    // half-done listing in the wrong place on the public site.
    name: '', organization: '', category: '', tags: [], phone: '', fax: '', email: '', website: '',
    address: '', town: '', serves_counties: [], hours: '', eligibility: '', age_groups: [], cost: [], medicaid_plans: [],
    medicaid_notes: '', description: '', private_notes: '', status: 'Active', review_by: '', visibility: 'Public', last_verified: '', last_checked_online: '',
    ...(prefill ?? {}),
  };
  document.title = `${id ? `Edit: ${l.name}` : 'Add a listing'}: Directory admin`;

  // Sections are for reading only; every field keeps its own label, name and id.
  const section = (key, title, intro, ...children) => el('section', { class: `form-section section-${key}`, 'aria-labelledby': `sec-${key}` },
    el('h2', { id: `sec-${key}` }, title),
    intro ? el('p', { class: 'section-intro' }, intro) : null,
    ...children);

  const form = el('form', { class: 'listing-form', novalidate: true, 'aria-label': id ? 'Edit listing' : 'Add listing' },
    section('basics', 'Basics', null,
      textField('name', 'Name (required)', 'text', 'Organization or program name.', l.name, { required: true }),
      textField('organization', 'Parent organization', 'text', 'Groups programs from the same agency, e.g. "Open Door Mission".', l.organization),
      selectField('category', 'Category (required)', l.category ? lists.categories : ['', ...lists.categories], l.category, 'Add or rename categories under "Categories & plans".'),
      textField('tags', 'Search words', 'text', 'Separate with commas, e.g. food pantry, groceries.', l.tags.join(', '))),
    section('contact', 'Contact, address and hours', 'General lines and addresses only. Staff names, direct lines and personal emails go in Private notes.',
      el('div', { class: 'grid2' },
        textField('phone', 'Phone', 'tel', 'General line only, e.g. (518) 555-1234 x12.', l.phone),
        textField('fax', 'Fax', 'tel', '', l.fax)),
      el('div', { class: 'grid2' },
        textField('email', 'Email', 'email', 'General address only.', l.email),
        textField('website', 'Website', 'url', 'e.g. https://example.org', l.website)),
      textField('address', 'Office address', 'text', 'Street, town, NY ZIP. Leave blank if there is no public address.', l.address),
      el('div', { class: 'field field-confirm', 'data-field': 'confirm_office_address' },
        el('div', { class: 'checks' }, el('label', {}, el('input', { type: 'checkbox', name: 'confirm_office_address', 'aria-describedby': 'f-confirm-hint' }),
          'This is an office address, not a shelter')),
        el('span', { class: 'hint', id: 'f-confirm-hint' }, 'Needed for domestic violence programs. Never store where a shelter is.')),
      el('div', { class: 'grid2' },
        textField('town', 'Town', 'text', 'Filled in from the address if left blank.', l.town),
        textField('hours', 'Hours', 'text', 'e.g. Monday–Friday, 9 AM–4 PM', l.hours))),
    section('who', 'Who it serves and cost', null,
      checkGroup('serves_counties', 'Counties served', COUNTIES, l.serves_counties, 'Regional = shows for every county.'),
      textField('eligibility', 'Who can get help', 'textarea', 'e.g. "60+ or have a disability"', l.eligibility, { rows: 2 }),
      checkGroup('age_groups', 'Age groups', AGE_GROUPS, l.age_groups, 'Leave all unticked if open to all ages.'),
      checkGroup('cost', 'Cost', COSTS, l.cost),
      checkGroup('medicaid_plans', 'Insurance accepted', lists.plans, l.medicaid_plans, 'Tick only plans you have confirmed. Add plans under "Categories & plans".'),
      textField('medicaid_notes', 'Insurance notes', 'text', 'e.g. "Does not take UnitedHealthcare Medicaid"', l.medicaid_notes)),
    section('description', 'Public description', null,
      textField('description', 'Description (public)', 'textarea', 'Plain summary anyone can understand.', l.description, { rows: 5 }),
      textField('sources', 'Sources (public)', 'textarea', 'Shown on the listing as "Source". Up to 3, one per line: web address | what it shows | date seen. Example: https://example.org/hours | Hours page | 2026-10-11', sourcesToText(l.sources), { rows: 3 })),
    section('private', 'Private: only you see this', 'Never shown on the public site. Never put client information here.',
      textField('private_notes', 'Private notes', 'textarea', 'Staff names, direct lines, scripts, intake tips.', l.private_notes, { rows: 5, private: true })),
    section('status', 'Status and checks', null,
      el('fieldset', { class: 'visibility', 'data-field': 'visibility', 'aria-describedby': 'f-visibility-err' },
        el('legend', {}, 'Visibility'),
        el('div', { class: 'checks' },
          el('label', { class: 'vis-public' }, el('input', { type: 'radio', name: 'visibility', value: 'Public', checked: l.visibility === 'Public' }), 'Public'),
          el('label', { class: 'vis-internal' }, el('input', { type: 'radio', name: 'visibility', value: 'Internal', checked: l.visibility === 'Internal' }), 'Internal (only you see the whole listing)')),
        el('p', { class: 'error-text', id: 'f-visibility-err', hidden: true })),
      el('div', { class: 'grid2' },
        selectField('status', 'Status', STATUSES, l.status),
        textField('review_by', 'Re-check by', 'date', 'Optional date to check this listing again.', l.review_by)),
      el('div', { class: 'grid2' },
        textField('last_verified', 'Last confirmed with the program', 'date', listing ? 'By phone or email. Or press "Verified today" in the bar at the bottom.' : 'The date you last confirmed the details with them.', l.last_verified),
        textField('last_checked_online', 'Last checked online', 'date', 'Checked against their website or an official source (research sets this).', l.last_checked_online))),
  );

  // Unsaved means different from what was loaded, so typing a value back
  // clears it. Changes are kept on this device as a draft (this tab only)
  // until saved, so a failed save, a lost signal or an expired login never
  // costs the owner their typing.
  // One draft per listing, per request, or for a plain new listing.
  const draftKey = listing ? `draft:${listing.id}` : fromRequest ? `draft:request:${fromRequest}` : 'draft:new';
  const loaded = JSON.stringify(readForm(form));
  let draftTimer;
  // Keeps (or drops) the draft from what the form holds now. Runs after the
  // page has moved on too (leaving keeps the draft, as the prompt says).
  // Only the changed fields are kept (so private notes are stored only when
  // they were edited), and nothing at all after a save was refused for what
  // the text says (rules 1 and 2), until a save succeeds.
  let draftsPaused = false;
  const writeDraft = () => {
    clearTimeout(draftTimer);
    if (pendingDraft === writeDraft) pendingDraft = null;
    if (draftsPaused) return;
    const now = readForm(form);
    const base = JSON.parse(loaded);
    const keys = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(base[k]));
    try {
      if (keys.length) {
        const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
        sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), base: pick(base), values: pick(now) }));
      } else sessionStorage.removeItem(draftKey);
    } catch { /* storage full or blocked: the form itself still works */ }
  };
  const dropDraft = () => {
    clearTimeout(draftTimer);
    if (pendingDraft === writeDraft) pendingDraft = null;
    try { sessionStorage.removeItem(draftKey); } catch { /* nothing kept */ }
  };
  const myGen = ++viewGen;
  const onInput = () => {
    if (!form.isConnected || myGen !== viewGen) return; // a late "change" while leaving the page
    dirty = JSON.stringify(readForm(form)) !== loaded;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 400);
    pendingDraft = writeDraft;
  };
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  // One save at a time: a second tap while the first is on its way would add
  // a new listing twice. The Save button says so while it waits.
  let saving = false;
  async function save(confirmWarnings = false) {
    if (saving) return;
    saving = true;
    const saveButton = form.querySelector('.actions-bar .save');
    const label = saveButton?.textContent;
    if (saveButton) { saveButton.setAttribute('aria-disabled', 'true'); saveButton.textContent = 'Saving…'; }
    try {
      await saveOnce(confirmWarnings);
    } finally {
      saving = false;
      if (saveButton?.isConnected) { saveButton.removeAttribute('aria-disabled'); saveButton.textContent = label; }
    }
  }

  async function saveOnce(confirmWarnings) {
    const body = { ...readForm(form), confirm_warnings: confirmWarnings };
    if (listing) body.expected_updated_at = listing.updated_at;
    if (fromRequest) body.from_request_id = fromRequest;
    try {
      const res = listing
        ? await api(`/listings/${encodeURIComponent(listing.id)}`, { method: 'PUT', body })
        : await api('/listings', { method: 'POST', body });
      if (!res.listing?.id) throw Object.assign(new Error(MSG_LOGIN), { status: 401 });
      dirty = false;
      dropDraft();
      if (fromRequest) { sessionStorage.removeItem('prefill'); refreshRequestCount(); }
      toast(fromRequest ? 'Saved. The request is marked handled.' : 'Saved.');
      location.hash = `#/edit/${res.listing.id}`;
      // Saved: if only the refresh fails, say so, without "Not saved".
      if (listing) await viewEdit(res.listing.id, { again: '.actions-bar .save' }).catch(() => toast('Saved. The page couldn\'t refresh: reload it to see the latest.', { long: true }));
    } catch (err) {
      // Rejected for what it says (rule 1 or 2, a bad phone…): nothing of it is
      // kept on the device. Any other failure keeps the typing as a draft.
      if (err.status === 422 && Object.keys(err.data?.errors || {}).length) { dropDraft(); draftsPaused = true; } else writeDraft();
      if (err.status === 422 && err.data) showProblems(form, err.data, () => save(true));
      else if (err.status === 409 && listing) {
        showProblems(form, { error: 'This listing was saved somewhere else (another tab?) after you opened it. Your changes are kept on this device: "Load the latest version" shows the other changes, then offers to put yours back.', errors: {} });
        form.querySelector('.summary')?.append(el('p', {}, el('button', { type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          try {
            await viewEdit(listing.id);
          } catch (loadErr) {
            btn.after(el('p', { class: 'action-error', role: 'alert' }, loadErr.message));
          }
        } }, 'Load the latest version')));
      } else showProblems(form, { error: `${err.message}${err.status === 0 || err.status === 401 || err.status === 403 ? ' Your changes are kept on this device and will be offered back after you reload. (If it did save, you\'ll see it after you reload.)' : ''}`, errors: {} });
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });

  // Pinned bar at the bottom of the form: Save and Verified today only.
  // Retire sits in its own box below the form so it can't be pressed by mistake.
  const actions = el('div', { class: 'actions-bar' },
    el('div', { class: 'actions-inner' },
      el('button', { type: 'submit', class: 'save' }, id ? 'Save changes' : 'Add listing'),
      listing ? el('button', { type: 'button', class: 'secondary', onclick: (e) => {
        if (dirty) { toast('Save your changes first.'); return; }
        runAction(e.currentTarget, async () => {
          await api(`/listings/${encodeURIComponent(listing.id)}/verify`, { method: 'POST' });
          toast('Marked as verified today.');
          await viewEdit(listing.id, { again: '.actions-bar .secondary' }).catch(() => toast('Verified. The page couldn\'t refresh: reload it to see the date.', { long: true }));
        });
      } }, 'Verified today') : null,
      el('p', { class: 'actions-note' }, id ? 'Changes go live as soon as you save.' : 'New listings go live when saved as Public.')),
  );
  form.append(actions);

  const retireZone = listing ? el('section', { class: `retire-zone${listing.retired ? ' is-retired' : ''}`, 'aria-labelledby': 'sec-retire' },
    el('h2', { id: 'sec-retire' }, listing.retired ? 'Restore this listing' : 'Retire this listing'),
    el('p', {}, listing.retired
      ? 'This listing is retired: hidden from the public site but kept with its history. Restore puts it back.'
      : 'Retiring hides it from the public site. It is kept with its history and you can restore it any time from "Retired".'),
    el('button', { type: 'button', class: listing.retired ? 'secondary' : 'danger', onclick: (e) => {
      if (dirty) { toast('Save your changes first.'); return; }
      runAction(e.currentTarget, async () => {
        await api(`/listings/${encodeURIComponent(listing.id)}/${listing.retired ? 'restore' : 'retire'}`, { method: 'POST' });
        toast(listing.retired ? restoredMessage(listing) : 'Retired. It no longer shows on the public site.');
        await viewEdit(listing.id, { again: '.retire-zone button' }).catch(() => toast('Done. The page couldn\'t refresh: reload it to see the change.', { long: true }));
      });
    } }, listing.retired ? 'Restore' : 'Retire')) : null;

  const head = [
    el('p', { class: 'back-link' }, el('a', { href: '#/listings' }, 'All listings')),
    el('h1', {}, id ? l.name : 'Add a listing'),
    listing ? el('div', { class: 'edit-meta' },
      el('p', { class: 'edit-badges' }, badges(listing), verifiedState(listing)),
      el('p', { class: 'meta-line' },
        listing.visibility === 'Public' && !listing.retired ? el('a', { href: `/listing/${listing.id}` }, 'View on public site') : 'Not shown on the public site',
        ` · Link name: ${listing.id}`)) : null,
    fromRequest ? el('div', { class: 'callout' },
      el('p', {}, `Pre-filled from provider request #${fromRequest}. Choose a category and check everything, then save. The request will be marked handled.`),
      el('p', {}, okToPublish
        ? 'The provider said it is OK to publish. The listing starts as Internal; switch it to Public once you have confirmed the details.'
        : 'The provider did NOT say it is OK to publish. Keep it Internal unless they agree.')) : null,
  ];

  const historySection = listing ? [
    el('h2', { class: 'history-heading' }, 'Change history'),
    history.length ? historyList(history) : emptyState('No changes yet', 'Each save will show here with what changed.'),
  ] : [];

  dirty = false;
  const draftBox = draftOffer(draftKey, form, listing, onInput);
  if (again) showKeepingPlace({ focus: again }, ...head, draftBox, form, retireZone, ...historySection);
  else show(...head, draftBox, form, retireZone, ...historySection);
}

function restoredMessage(l) {
  return l.visibility === 'Internal' ? 'Restored. It is Internal, so only you see it.' : 'Restored. It shows on the public site again.';
}

// Puts one saved value back into the edit form.
function setFormValue(form, name, value) {
  const boxes = form.querySelectorAll(`input[name="${name}"]`);
  if (boxes.length && (boxes[0].type === 'checkbox' || boxes[0].type === 'radio')) {
    if (name === 'confirm_office_address') { boxes[0].checked = value === true; return; }
    for (const b of boxes) b.checked = Array.isArray(value) ? value.includes(b.value) : b.value === value;
    return;
  }
  const ctl = form.elements[name];
  if (!ctl) return;
  ctl.value = name === 'tags' ? value.join(', ') : name === 'sources' ? sourcesToText(value) : value;
}

// A draft left from before (failed save, lost signal, expired login, a
// reload): offer to put the changes back. Only fields changed in the draft
// are restored, so edits saved elsewhere in the meantime are kept.
function draftOffer(key, form, listing, onInput) {
  let draft = null;
  try { draft = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { draft = null; }
  if (!draft || !draft.values || !draft.base) return null;
  const changed = Object.keys(draft.values).filter((k) => JSON.stringify(draft.values[k]) !== JSON.stringify(draft.base[k]));
  const current = readForm(form);
  const differs = changed.filter((k) => JSON.stringify(draft.values[k]) !== JSON.stringify(current[k]));
  if (!differs.length) { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } return null; }
  const when = new Date(draft.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const label = (k) => form.querySelector(`[data-field="${k}"] label, [data-field="${k}"] legend`)?.textContent.replace(/\s*\(required\)/, '') || k;
  const box = el('section', { class: 'draft-offer', role: 'region', 'aria-labelledby': 'draft-h' },
    el('h2', { id: 'draft-h' }, 'You have unsaved changes'),
    el('p', { role: 'status' }, `From ${when}, not saved yet: ${differs.map(label).join(', ')}.`),
    el('div', { class: 'row' },
      el('button', { type: 'button', onclick: () => {
        for (const k of differs) setFormValue(form, k, draft.values[k]);
        onInput();
        box.remove();
        toast('Your changes are back. Press Save to keep them.');
        form.querySelector(`[data-field="${differs[0]}"] input, [data-field="${differs[0]}"] textarea, [data-field="${differs[0]}"] select`)?.focus();
      } }, 'Put my changes back'),
      el('button', { type: 'button', class: 'secondary', onclick: () => {
        try { sessionStorage.removeItem(key); } catch { /* nothing kept */ }
        box.remove();
        form.querySelector('input, select, textarea')?.focus();
      } }, 'Discard them')));
  return box;
}

// ---------- Due for re-check ----------
async function viewRecheck({ again = null, openUnconfirmed = false } = {}) {
  setNav('recheck');
  document.title = 'Due for re-check: Directory admin';
  const { listings, unconfirmed, reported = [] } = await api('/recheck');
  const today = todayLocal();
  const reason = (l) => {
    if (l.review_by && l.review_by <= today) return `Re-check date ${formatDate(l.review_by)} has passed`;
    if (!l.last_verified && !l.last_checked_online) return 'Never checked';
    return checkedWords(l).replace(/^./, (c) => c.toUpperCase());
  };
  // After "Verified today" the page is drawn again (counts, both lists and the
  // visitor reports change), keeping the place: focus goes to the next
  // listing's button, or the page heading when the list is done.
  const item = (l, i, all) => {
    const next = all[i + 1] ?? all[i - 1];
    const li = el('li', { class: `item${l.visibility === 'Internal' ? ' is-internal' : ''}`, 'data-id': l.id },
      el('div', { class: 'item-main' },
        el('a', { class: 'item-name', href: `#/edit/${l.id}` }, l.name),
        el('p', { class: 'item-meta' }, el('span', { class: `state ${(l.review_by && l.review_by <= today) || l.last_verified ? 'state-due' : 'state-never'}` }, reason(l)),
          telHref(l.phone) ? [' · ', phoneLink(l.phone)] : l.phone ? ` · ${l.phone}` : '')),
      el('div', { class: 'item-side' },
        el('span', { class: 'item-badges' }, badges(l)),
        el('button', { type: 'button', class: 'secondary', onclick: (e) => { const btn = e.currentTarget; runAction(btn, async () => {
          await api(`/listings/${encodeURIComponent(l.id)}/verify`, { method: 'POST' });
          toast(`${l.name}: confirmed today.`);
          const scope = btn.closest('details.unconfirmed') ? 'details.unconfirmed ' : '.due-list ';
          await viewRecheck({ again: next ? `${scope}li[data-id="${CSS.escape(next.id)}"] button` : 'h1', openUnconfirmed: Boolean(document.querySelector('details.unconfirmed')?.open) })
            .catch(() => { btn.closest('li')?.remove(); toast('Done. The list couldn\'t refresh: reload the page to see the new counts.', { long: true }); });
        }); } }, 'Verified today', el('span', { class: 'visually-hidden' }, `: ${l.name}`))));
    return li;
  };
  const weekly = Math.max(1, Math.ceil(unconfirmed.length / 52));
  (again ? (...n) => showKeepingPlace({ focus: again }, ...n) : show)(
    pageHead('Due for re-check'),
    reported.length ? el('section', { class: 'reported', 'aria-labelledby': 'reported-h' },
      el('h2', { id: 'reported-h' }, `Reported by visitors (last 90 days): ${reported.length}`),
      el('p', { class: 'note' }, 'Anonymous one-tap reports from the public site. They never change a listing, and the counts are not verified (anyone can tap). Check these first, especially any with 2 or more reports.'),
      el('ul', { class: 'items' }, reported.map((r) => el('li', { class: 'item' },
        el('div', { class: 'item-main' },
          el('a', { class: 'item-name', href: `#/edit/${encodeURIComponent(r.id)}` }, r.name),
          el('p', { class: 'item-meta' },
            el('span', { class: `state ${r.total >= 2 ? 'state-due' : 'state-never'}` }, `${r.total} report${r.total === 1 ? '' : 's'}`),
            ` · ${[r.phone ? `number didn't work: ${r.phone}` : '', r.closed ? `closed or moved: ${r.closed}` : '', r.full ? `not taking new people: ${r.full}` : ''].filter(Boolean).join(', ')} · latest ${formatDate(r.latest)}`,
            // `phone` is a count; the listing's own number is `listing_phone`.
            telHref(r.listing_phone) ? [' · ', phoneLink(r.listing_phone)] : null))))))
      : null,
    el('p', { class: 'lede' }, `Due now: ${listings.length}. Food, shelter, rent help, crisis and domestic violence listings are re-checked every 3 months; everything else every 12 months, counted from the last check (by phone, or online by research). Call or email them, then press "Verified today" or edit the listing.`),
    callSheetPanel(listings.length ? listings : unconfirmed, reason),
    listings.length ? el('ul', { class: 'items due-list' }, listings.map(item)) : emptyState('All caught up', 'Nothing is due for a re-check right now.'),
    unconfirmed.length ? el('details', { class: 'unconfirmed', open: openUnconfirmed },
      el('summary', {}, `Not yet confirmed with the program by phone or email (${unconfirmed.length})`),
      el('p', { class: 'section-intro' }, `These were checked online but nobody has called them yet. About ${weekly} a week gets through all of them in a year. Oldest checks are first.`),
      el('ul', { class: 'items' }, unconfirmed.map(item))) : null,
  );
}

// ---------- Printable call sheet ----------
// A paper list for a batch of verification calls: who to call, what the site
// says now, and boxes to tick. Work through it, then press "Verified today" or
// edit each listing. Private notes are left off unless you ask for them.
function callSheetPanel(listings, reason) {
  const cats = [...new Set(listings.map((l) => l.category).filter(Boolean))].sort();
  const cat = el('select', { id: 'cs-cat' }, el('option', { value: '' }, 'All categories'), ...cats.map((c) => el('option', { value: c }, c)));
  const count = el('select', { id: 'cs-count' }, ...[10, 20, 40].map((n) => el('option', { value: String(n) }, `${n} listings`)), el('option', { value: '0' }, 'All'));
  const priv = el('input', { type: 'checkbox', id: 'cs-private' });
  return el('section', { class: 'call-sheet-panel', 'aria-labelledby': 'cs-h' },
    el('h2', { id: 'cs-h' }, 'Print a call sheet'),
    el('p', { class: 'section-intro' }, 'Pick a batch to call this week, for example 10 at a time. The sheet lists each number and what the site says now, with boxes to tick.'),
    el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'cs-cat' }, 'Category'), cat),
      el('div', { class: 'field' }, el('label', { for: 'cs-count' }, 'How many'), count),
      el('div', { class: 'checks' }, el('label', {}, priv, 'Include my private notes'))),
    el('p', {}, el('button', { type: 'button', onclick: () => {
      let chosen = listings.filter((l) => !cat.value || l.category === cat.value);
      if (count.value !== '0') chosen = chosen.slice(0, Number(count.value));
      printCallSheet(chosen, reason, priv.checked);
    } }, 'Print call sheet')));
}

function printCallSheet(chosen, reason, withPrivate) {
  const sheet = document.getElementById('call-sheet') || document.body.appendChild(el('section', { id: 'call-sheet', class: 'call-sheet', 'aria-hidden': 'true' }));
  const row = (label, value) => (value ? el('p', {}, el('strong', {}, `${label}: `), value) : null);
  sheet.replaceChildren(
    el('h1', {}, 'Verification calls'),
    el('p', { class: 'cs-sub' }, `Printed ${formatDate(todayLocal())} · ${chosen.length} listings. Ask: are the phone, hours, address, who can get help, cost and insurance still right?`),
    el('ol', {}, chosen.map((l) => el('li', {},
      el('div', { class: 'cs-head' }, el('h2', {}, l.name), el('span', { class: 'cs-phone' }, l.phone || 'No phone listed')),
      el('p', { class: 'cs-meta' }, [l.category, l.town, reason(l)].filter(Boolean).join(' · ')),
      row('Hours', l.hours), row('Address', l.address), row('Who can get help', l.eligibility),
      row('Insurance', [l.medicaid_plans.join(', '), l.medicaid_notes].filter(Boolean).join('. ')),
      row('Website', l.website), withPrivate ? row('Private notes', l.private_notes) : null,
      el('p', { class: 'cs-boxes' }, '☐ Still right   ☐ Changed (note below)   ☐ No answer / left message   ☐ Closed'),
      el('p', { class: 'cs-notes' }, 'Notes: ')))));
  document.body.classList.add('print-call-sheet');
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('print-call-sheet'));

// ---------- Retired (archive) ----------
async function viewRetired({ again = null } = {}) {
  setNav('retired');
  document.title = 'Retired: Directory admin';
  const { listings } = await api('/listings');
  const retired = listings.filter((l) => l.retired);
  const list = el('ul', { class: 'items' }, retired.map((l, i) => {
    const next = retired[i + 1] ?? retired[i - 1];
    const li = el('li', { class: 'item is-retired', 'data-id': l.id },
      el('div', { class: 'item-main' },
        el('a', { class: 'item-name', href: `#/edit/${l.id}` }, l.name),
        el('p', { class: 'item-meta' }, [l.category, l.town].filter(Boolean).join(' · '))),
      el('div', { class: 'item-side' },
        el('button', { type: 'button', class: 'secondary', onclick: (e) => runAction(e.currentTarget, async () => {
          await api(`/listings/${encodeURIComponent(l.id)}/restore`, { method: 'POST' });
          toast(`${l.name}: ${restoredMessage(l)}`);
          await viewRetired({ again: next ? `li[data-id="${CSS.escape(next.id)}"] button` : 'h1' })
            .catch(() => { li.remove(); toast('Restored. The list couldn\'t refresh: reload the page to see it.', { long: true }); });
        }) }, 'Restore', el('span', { class: 'visually-hidden' }, `: ${l.name}`))));
    return li;
  }));
  (again ? (...n) => showKeepingPlace({ focus: again }, ...n) : show)(
    pageHead('Retired listings'),
    el('p', { class: 'lede' }, `${retired.length} retired (archived) listings. They are hidden from the public site but kept here with their history. Open one to see or edit it, or press Restore to put it back.`),
    retired.length ? list : emptyState('Nothing retired', 'Listings you retire will wait here, ready to restore.'),
  );
}

// ---------- Barrier reports (anonymous, from the Community needs page) ----------
async function viewBarriers() {
  setNav('barriers');
  document.title = 'Barrier reports: Directory admin';
  const { reports } = await api('/barriers');
  const labels = {};
  try {
    const res = await fetch('/api/barriers/summary', { headers: { Accept: 'application/json' } });
    for (const b of (await res.json()).barriers) labels[b.id] = b.label;
  } catch { /* labels fall back to ids */ }
  const counts = {};
  for (const r of reports) for (const b of r.barriers) counts[b] = (counts[b] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!reports.length) {
    show(pageHead('Barrier reports'), emptyState('No reports yet', 'Anonymous reports from the Community needs page will show here.'));
    return;
  }
  show(
    pageHead('Barrier reports'),
    el('p', { class: 'lede' }, `${reports.length} anonymous reports. Comments are only visible here. The public page shows totals only, and hides any number under 5.`),
    el('h2', {}, 'All reports by barrier (exact counts, admin only)'),
    el('ul', { class: 'tally' }, top.map(([b, n]) => el('li', {}, el('span', { class: 'tally-label' }, labels[b] || b), el('span', { class: 'tally-count' }, String(n))))),
    el('h2', {}, 'Latest reports'),
    el('ul', { class: 'note-list' }, reports.map((r) => el('li', { class: 'note-card' },
      el('p', { class: 'note-meta' }, `${formatDateTime(r.created_at)} · ${r.county}${r.reporter ? ` · ${r.reporter}` : ''}`),
      el('ul', { class: 'chips', 'aria-label': 'Barriers' }, r.barriers.map((b) => el('li', {}, labels[b] || b))),
      r.comment ? el('p', { class: 'note-text' }, el('span', { class: 'note-label' }, 'Comment: '), r.comment) : null))),
  );
}

// ---------- "Don't see the help you need?" messages (anonymous) ----------
// ---------- Site notice ----------
// One short message under the crisis bar on every public page, e.g. "Code Blue
// shelter open tonight". Optional last day; after it the notice hides itself.
async function viewNotice() {
  setNav('notice');
  document.title = 'Site notice: Directory admin';
  const { notice } = await api('/notice');
  const message = el('textarea', { id: 'n-message', rows: 3, maxlength: 280, 'aria-describedby': 'n-message-hint n-message-err' });
  message.value = notice.message;
  const count = el('span', { class: 'hint', id: 'n-count', 'aria-live': 'polite' });
  const updateCount = () => { count.textContent = `${message.value.length} of 280 characters`; };
  message.addEventListener('input', updateCount); updateCount();
  // Unsent notice text counts as unsaved, so leaving the page asks first.
  let savedMessage = notice.message;
  message.addEventListener('input', () => { dirty = message.value !== savedMessage; });
  const endsOn = el('input', { type: 'date', id: 'n-ends', value: notice.ends_on, 'aria-describedby': 'n-ends-hint n-ends-err' });
  const level = (v, text) => el('label', {}, el('input', { type: 'radio', name: 'n-level', value: v, checked: (notice.level || 'info') === v }), text);
  const msgErr = el('p', { class: 'error-text', id: 'n-message-err', hidden: true });
  const endErr = el('p', { class: 'error-text', id: 'n-ends-err', hidden: true });
  const status = el('p', { class: 'notice-status' });
  const today = todayLocal();
  const showStatus = (n) => {
    status.textContent = !n.message ? 'No notice is showing on the public site.'
      : n.ends_on && n.ends_on < today ? `Not showing: its last day (${formatDate(n.ends_on)}) has passed.`
        : `Showing on every public page${n.ends_on ? ` through ${formatDate(n.ends_on)}` : ' until you clear it'}.`;
  };
  showStatus(notice);
  async function save(values, button) {
    msgErr.hidden = true; endErr.hidden = true; message.removeAttribute('aria-invalid'); endsOn.removeAttribute('aria-invalid');
    await runAction(button, async () => {
      try {
        const r = await api('/notice', { method: 'PUT', body: values });
        message.value = r.notice.message; endsOn.value = r.notice.ends_on; updateCount(); showStatus(r.notice);
        savedMessage = r.notice.message; dirty = false;
        toast(r.notice.message ? 'Notice saved. It shows on the public site now.' : 'Notice cleared.');
        button.disabled = false;
      } catch (err) {
        const e = err.data?.errors || {};
        if (e.message) { msgErr.textContent = e.message; msgErr.hidden = false; message.setAttribute('aria-invalid', 'true'); message.focus(); }
        if (e.ends_on) { endErr.textContent = e.ends_on; endErr.hidden = false; endsOn.setAttribute('aria-invalid', 'true'); if (!e.message) endsOn.focus(); }
        if (e.message || e.ends_on) { button.disabled = false; return; }
        throw err;
      }
    });
  }
  const form = el('form', { class: 'notice-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    save({ message: message.value, ends_on: endsOn.value, level: form.querySelector('[name="n-level"]:checked')?.value || 'info' }, form.querySelector('button[type="submit"]'));
  } },
    el('div', { class: 'field' }, el('label', { for: 'n-message' }, 'Notice text'),
      el('span', { class: 'hint', id: 'n-message-hint' }, 'One short line, e.g. "Code Blue: the Glens Falls warming center is open tonight from 7 PM." Plain text; no client information.'),
      message, count, msgErr),
    el('fieldset', { class: 'field' }, el('legend', {}, 'How it looks'),
      el('div', { class: 'checks' }, level('info', 'Notice (yellow)'), level('urgent', 'Important (red)'))),
    el('div', { class: 'field' }, el('label', { for: 'n-ends' }, 'Last day to show it (optional)'),
      el('span', { class: 'hint', id: 'n-ends-hint' }, 'After this day the notice hides itself. Leave blank to show it until you clear it.'),
      endsOn, endErr),
    el('div', { class: 'row' },
      el('button', { type: 'submit' }, 'Save notice'),
      el('button', { type: 'button', class: 'secondary', onclick: (e) => save({ message: '', ends_on: '', level: 'info' }, e.currentTarget) }, 'Clear notice')));
  show(
    pageHead('Site notice'),
    el('p', { class: 'lede' }, 'A short message shown under the red crisis bar on every public page. Use it for things like Code Blue nights, a closed office, or when HEAP opens.'),
    status,
    form,
    await pauseSection(),
  );
}

// ---------- Emergency pause ----------
// One switch that makes every public page show only the crisis numbers and 211
// (for example if wrong information spreads, or the site is attacked). The
// admin panel keeps working. Two steps, so it can't be pressed by accident.
async function pauseSection() {
  const box = el('section', { class: 'pause-box', 'aria-labelledby': 'pause-h' });
  async function render(state) {
    const confirmArea = el('div', { class: 'pause-confirm', hidden: true });
    const statusText = state.paused
      ? 'The public site is PAUSED. Visitors see only the crisis numbers and 211.'
      : 'The public site is on.';
    const set = (paused, button) => runAction(button, async () => {
      const r = await api('/pause', { method: 'PUT', body: { paused } });
      updatePauseBanner(r.paused);
      toast(r.paused ? 'The public site is paused.' : 'The public site is back on.');
      box.replaceChildren(...(await render(r)));
    });
    const main = state.paused
      ? el('button', { type: 'button', onclick: (e) => set(false, e.currentTarget) }, 'Turn the public site back on')
      : el('button', { type: 'button', class: 'danger', onclick: () => { confirmArea.hidden = false; confirmArea.querySelector('button').focus(); } }, 'Pause the public site');
    confirmArea.append(
      el('p', {}, 'Are you sure? Every public page will show only the crisis numbers and 211 until you turn it back on.'),
      el('div', { class: 'review-buttons' },
        el('button', { type: 'button', class: 'danger', onclick: (e) => set(true, e.currentTarget) }, 'Yes, pause it now'),
        el('button', { type: 'button', class: 'secondary', onclick: () => { confirmArea.hidden = true; } }, 'Cancel')));
    return [
      el('h2', { id: 'pause-h' }, 'Emergency pause'),
      el('p', { class: `pause-status${state.paused ? ' on' : ''}`, role: 'status' }, statusText),
      state.backup_switch ? el('p', { class: 'note' }, 'The backup switch (SITE_PAUSED in the Cloudflare dashboard) is on, so the site stays paused until that setting is removed. See HANDOFF.md.') : null,
      el('p', { class: 'note' }, 'Use this if wrong information is spreading or the site is being misused. This admin panel keeps working while the site is paused.'),
      main,
      confirmArea,
    ].filter(Boolean);
  }
  box.replaceChildren(...(await render(await api('/pause'))));
  return box;
}

function updatePauseBanner(paused) {
  let b = document.getElementById('pause-banner');
  if (!paused) { b?.remove(); return; }
  if (b) return;
  b = el('p', { id: 'pause-banner', class: 'pause-banner', role: 'status' }, 'The public site is paused. ', el('a', { href: '#/notice' }, 'Turn it back on'));
  document.querySelector('.admin-header')?.after(b);
}

// The "Don't see the help you need?" form has been removed from the public
// site; this view only keeps the messages it collected. The menu item is hidden
// at startup when there are none (the page still opens from #/suggestions).
async function viewSuggestions() {
  setNav('suggestions');
  // The page is open, so its menu item shows even if it started hidden.
  document.querySelector('[data-nav="suggestions"]')?.closest('li')?.removeAttribute('hidden');
  document.title = 'Old help suggestions: Directory admin';
  const { suggestions } = await api('/suggestions');
  show(
    pageHead('Old help suggestions'),
    el('p', { class: 'lede' }, `${suggestions.length} old anonymous messages from the "Don't see the help you need?" form, which has been removed from the public site; only you see these.`),
    suggestions.length
      ? el('ul', { class: 'note-list' }, suggestions.map((r) => el('li', { class: 'note-card' },
        el('p', { class: 'note-meta' }, `${formatDateTime(r.created_at)}${r.county ? ` · ${r.county}` : ''}`),
        el('p', { class: 'note-text' }, r.looking_for))))
      : emptyState('No messages', 'The form that collected these has been removed, so nothing new will arrive.'),
  );
}

// ---------- To review: decisions, checks and ideas waiting on you ----------
const REVIEW_KINDS = {
  decision: { label: 'Decision', buttons: [['yes', 'Yes, do it'], ['later', 'Not now'], ['no', 'No']] },
  idea: { label: 'Idea', buttons: [['yes', 'Yes, do it'], ['later', 'Not now'], ['no', 'No']] },
  fyi: { label: 'Claude decided', buttons: [['ok', 'OK'], ['change', 'Change this']] },
  check: { label: 'Check', buttons: [['done', 'Done'], ['dismissed', 'Not needed']] },
  call: { label: 'Phone call', buttons: [['done', 'Done'], ['dismissed', 'Not needed']] },
  task: { label: 'Task', buttons: [['done', 'Done'], ['dismissed', 'Not needed']] },
  info: { label: 'Report', buttons: [] },
};
const REVIEW_ANSWERS = { yes: 'Yes, do it', later: 'Not now', no: 'No', ok: 'OK', change: 'Change this', done: 'Done', dismissed: 'Not needed' };
let reviewFilter = 'open';

async function viewReview() {
  setNav('review');
  document.title = 'To review: Directory admin';
  const { items } = await api('/review');
  const waitingOf = (list) => list.filter((i) => i.status === 'open' && i.kind !== 'info');

  function itemCard(item) {
    const kind = REVIEW_KINDS[item.kind] || REVIEW_KINDS.check;
    const noteId = `rn-${item.id}`;
    const note = el('textarea', { id: noteId, rows: 2, maxlength: 2000 });
    note.value = item.owner_note || '';
    const card = el('li', { class: `note-card review-item${item.status === 'open' ? '' : ' answered'}` });
    const answer = (status, button) => runAction(button, async () => {
      const r = await api(`/review/${item.id}`, { method: 'POST', body: { status, note: note.value } });
      Object.assign(item, r.item);
      card.replaceWith(itemCard(item));
      updateCounts();
      toast(status === 'open' ? 'Moved back to waiting.' : `Saved: ${REVIEW_ANSWERS[status]}.`);
    });
    card.append(...[
      el('p', { class: 'note-meta' }, el('span', { class: `kind kind-${item.kind}` }, kind.label), item.source ? ` · ${item.source}` : ''),
      el('h3', { class: 'review-title' }, item.title),
      item.detail ? el('p', { class: 'review-detail' }, item.detail) : null,
      item.listing_id ? el('p', {}, el('a', { href: `#/edit/${encodeURIComponent(item.listing_id)}` }, 'Open the listing')) : null,
      item.kind !== 'info' && item.status !== 'open'
        ? el('p', { class: 'review-answer' }, el('strong', {}, `Your answer: ${REVIEW_ANSWERS[item.status] || item.status}`),
          item.owner_note ? ` · ${item.owner_note}` : '', ` (${formatDate(item.updated_at)})`)
        : null,
      item.kind === 'info' ? null : el('details', { class: 'review-note', open: Boolean(item.owner_note) && item.status === 'open' },
        el('summary', {}, item.owner_note ? 'Your note' : 'Add a note (optional)'),
        el('label', { for: noteId, class: 'visually-hidden' }, `Note for: ${item.title}`), note),
      item.kind === 'info' ? null : el('div', { class: 'review-buttons' },
        item.status === 'open'
          ? kind.buttons.map(([status, text], i) => el('button', { type: 'button', class: i ? 'secondary' : '',
            onclick: (e) => answer(status, e.currentTarget) }, text, el('span', { class: 'visually-hidden' }, `: ${item.title}`)))
          : [el('button', { type: 'button', class: 'secondary', onclick: (e) => answer(item.status, e.currentTarget) }, 'Save note', el('span', { class: 'visually-hidden' }, `: ${item.title}`)),
            el('button', { type: 'button', class: 'secondary', onclick: (e) => answer('open', e.currentTarget) }, 'Undo', el('span', { class: 'visually-hidden' }, `: ${item.title}`))]),
    ].filter(Boolean));
    return card;
  }

  const countLine = el('p', { class: 'lede', role: 'status' });
  function updateCounts() {
    const waiting = waitingOf(items).length;
    const answered = items.filter((i) => i.kind !== 'info' && i.status !== 'open').length;
    countLine.textContent = `${waiting} waiting for you, ${answered} answered. Your answers save as you click, from any device. Claude reads them the next time you ask it to.`;
    setNavCount('review', waiting);
  }

  const groups = [];
  for (const i of items) {
    let g = groups.find((x) => x.name === i.grp);
    if (!g) { g = { name: i.grp || 'Other', items: [] }; groups.push(g); }
    g.items.push(i);
  }
  const listArea = el('div');
  function render() {
    const keep = (i) => (reviewFilter === 'report' ? i.kind === 'info'
      : reviewFilter === 'all' ? i.kind !== 'info'
        : i.kind !== 'info' && (reviewFilter === 'open' ? i.status === 'open' : i.status !== 'open'));
    const shown = groups.map((g) => ({ ...g, items: g.items.filter(keep) }))
      .filter((g) => g.items.length);
    listArea.replaceChildren(...(shown.length
      ? shown.map((g, n) => el('details', { class: 'review-group', open: n === 0 && reviewFilter !== 'report' },
        el('summary', {}, el('span', { class: 'review-group-name' }, g.name), el('span', { class: 'tally-count' }, String(g.items.length))),
        el('ul', { class: 'note-list' }, g.items.map(itemCard))))
      : [emptyState(reviewFilter === 'open' ? 'Nothing waiting' : 'Nothing here yet', reviewFilter === 'open' ? 'You have answered everything. New items appear here when Claude adds them.' : 'Items you answer show here.')]));
  }
  const filterButtons = [['open', 'Waiting'], ['answered', 'Answered'], ['all', 'All'], ['report', 'Review report']].map(([f, text]) =>
    el('button', { type: 'button', class: reviewFilter === f ? '' : 'secondary', 'aria-pressed': String(reviewFilter === f), onclick: (e) => {
      reviewFilter = f;
      for (const b of e.currentTarget.parentNode.children) { const on = b === e.currentTarget; b.className = on ? '' : 'secondary'; b.setAttribute('aria-pressed', String(on)); }
      render();
    } }, text));
  updateCounts();
  render();
  show(
    pageHead('To review'),
    countLine,
    el('p', { class: 'lede' }, 'Decisions, checks and ideas that need you. "Claude decided" items are choices Claude already made; press OK, or "Change this" and add a note. Phone calls and checks: press Done after you call or update the listing. "Review report" shows everything the October 2026 accuracy review changed, for reference.'),
    el('div', { class: 'review-filters', role: 'group', 'aria-label': 'Show' }, filterButtons),
    listArea,
  );
}

// ---------- Categories & plans ----------
async function viewLists() {
  setNav('lists');
  document.title = 'Categories and plans: Directory admin';
  const [c, p] = await Promise.all([api('/lists/categories'), api('/lists/plans')]);

  function section(kind, title, items, help) {
    const ul = el('ul', { class: 'items list-items' });
    const draw = (rows) => ul.replaceChildren(...rows.map((item) => {
      // Names the site's safety features, search words or Learn page use can't
      // be renamed here (the server refuses too); the note says why.
      const input = el('input', { type: 'text', value: item.name, 'aria-label': item.locked ? `${item.name} (used by the site, can't be renamed here)` : `New name for ${item.name}`, readonly: item.locked });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.closest('li').querySelector('button.rename')?.click(); } });
      return el('li', {},
        el('span', { class: 'grow' }, input, item.locked ? el('span', { class: 'locked-note' }, 'Locked') : null),
        el('span', { class: 'used' }, `${item.used} listing${item.used === 1 ? '' : 's'}`),
        el('button', { type: 'button', class: 'secondary rename', disabled: item.locked, onclick: (e) => runAction(e.currentTarget, async () => {
          const r = await api(`/lists/${kind}/${encodeURIComponent(item.name)}`, { method: 'PUT', body: { name: input.value } });
          draw(r.items); await loadLists(); toast('Renamed. Listings using it were updated.');
        }) }, 'Rename', el('span', { class: 'visually-hidden' }, `: ${item.name}`)),
        // Remove only works when nothing uses the item; otherwise the button is
        // disabled and the "N listings" count beside it says why. The server
        // refuses too, and runAction shows its reason if that ever happens.
        el('button', { type: 'button', class: 'danger', disabled: item.used > 0 || item.locked, onclick: (e) => {
          runAction(e.currentTarget, async () => {
            const r = await api(`/lists/${kind}/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
            draw(r.items); await loadLists(); toast('Removed.');
          });
        } }, 'Remove', el('span', { class: 'visually-hidden' }, `${item.used > 0 || item.locked ? ' (in use)' : ''}: ${item.name}`)));
    }));
    draw(items);
    const addInput = el('input', { type: 'text', id: `add-${kind}`, 'aria-describedby': `add-${kind}-err` });
    return [el('section', { class: 'list-section', 'aria-labelledby': `h-${kind}` },
      el('h2', { id: `h-${kind}` }, title),
      el('p', { class: 'section-intro' }, help),
      ul,
      el('form', { class: 'toolbar add-row', onsubmit: async (e) => {
        e.preventDefault();
        const err = e.currentTarget.parentNode.querySelector(`#add-${kind}-err`);
        try {
          const r = await api(`/lists/${kind}`, { method: 'POST', body: { name: addInput.value } });
          addInput.value = ''; addInput.removeAttribute('aria-invalid'); err.hidden = true; err.textContent = '';
          draw(r.items); await loadLists(); toast('Added.');
        } catch (x) { addInput.setAttribute('aria-invalid', 'true'); err.textContent = x.message; err.hidden = false; addInput.focus(); }
      } },
      el('div', { class: 'field' }, el('label', { for: `add-${kind}` }, `Add a ${kind === 'plans' ? 'plan' : 'category'}`), addInput),
      el('button', { type: 'submit' }, 'Add')),
      el('p', { class: 'error-text', id: `add-${kind}-err`, role: 'alert', hidden: true }))];
  }

  show(
    pageHead('Categories & insurance plans'),
    ...section('categories', 'Categories', c.items, 'Renaming updates every listing in that category. A category in use can\'t be removed. Names marked "Locked" are built into the search words, safety features or Learn page, so ask Claude to rename those: Claude changes them everywhere at once.'),
    ...section('plans', 'Insurance plans', p.items, 'Renaming updates every listing that lists that plan.'),
  );
}

// ---------- Requests inbox (Phase 5) ----------
const REQUEST_LABELS = [
  ['organization', 'Organization'], ['correction', 'What needs to be corrected'], ['services', 'Services'], ['eligibility', 'Who can get help, and ages'],
  ['age_groups', 'Age groups'], ['cost', 'Cost'], ['medicaid', 'Insurance accepted'], ['counties', 'Counties served'],
  ['address', 'Address'], ['hours', 'Hours'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['how_to_start', 'How clients start'], ['submitter_name', 'Submitted by'], ['submitter_contact', 'Submitter contact'],
  ['ok_to_publish', 'OK to publish'],
];

function requestValue(f, key) {
  if (key === 'address') return f.no_public_address ? 'No public address' : f.address;
  // Corrections have no "OK to publish" question.
  if (key === 'ok_to_publish') return f.request_type === 'correction' ? '' : f.ok_to_publish ? 'Yes' : 'No';
  const v = f[key];
  return Array.isArray(v) ? v.join(', ') : v;
}

// The listing name and id from a correction ("Warren County DSS [listing: warren-county-dss]").
function correctionListingName(text) {
  return String(text || '').replace(/\s*\[listing: [a-z0-9-]+\]\s*$/, '').trim();
}
function correctionListingId(text) {
  return (String(text || '').match(/\[listing: ([a-z0-9-]+)\]\s*$/) || [])[1] || '';
}

export function listingFromRequest(r) {
  const f = r.fields;
  const pick = (vals, allowed) => (Array.isArray(vals) ? vals.filter((v) => allowed.includes(v)) : []);
  return {
    name: f.organization ?? '',
    description: [f.services, f.how_to_start ? `How to start: ${f.how_to_start}` : ''].filter(Boolean).join('\n\n'),
    eligibility: f.eligibility ?? '',
    age_groups: pick(f.age_groups, AGE_GROUPS),
    cost: pick(f.cost, COSTS),
    medicaid_plans: pick(f.medicaid_plans, lists.plans),
    medicaid_notes: f.medicaid ?? '',
    serves_counties: pick(f.counties, COUNTIES),
    address: f.no_public_address ? '' : (f.address ?? ''),
    hours: f.hours ?? '', phone: f.phone ?? '', email: f.email ?? '', website: f.website ?? '',
    private_notes: `From provider request #${r.id} (${formatDate(r.created_at)}), submitted by ${f.submitter_name ?? ''} (${f.submitter_contact ?? ''}).`,
    // Starts hidden, with no category, so nothing goes public until the owner
    // has checked it and chosen to publish.
    visibility: 'Internal',
    category: '',
  };
}

// `again` is set when the page is rebuilt after Mark handled: the scroll
// position is kept and focus goes to the next new request's heading (or the
// "Handled" summary when none are left) instead of the top of the page.
// The small number next to a menu item ("To review 131", "Requests 1").
function setNavCount(nav, n) {
  const badge = document.querySelector(`[data-nav="${nav}"] .count`);
  if (badge) badge.textContent = n ? String(n) : '';
}

// New (not yet handled) provider requests, for the menu count.
function refreshRequestCount() {
  api('/requests').then(({ requests }) => setNavCount('requests', requests.filter((r) => r.status === 'New').length))
    .catch(() => { /* the count is a convenience */ });
}

async function viewRequests({ again = null } = {}) {
  setNav('requests');
  document.title = 'Requests: Directory admin';
  let data;
  try {
    data = await api('/requests');
  } catch (err) {
    if (err.status === 404) { show(pageHead('Requests'), emptyState('Not set up yet', 'The provider request form is not set up yet (Phase 5).')); return; }
    throw err;
  }
  const { requests } = data;
  const open = requests.filter((r) => r.status === 'New');
  setNavCount('requests', open.length);
  const handled = requests.filter((r) => r.status !== 'New');

  const card = (r) => {
    const note = el('input', { type: 'text', id: `note-${r.id}`, placeholder: 'e.g. Declined: outside our area' });
    const isCorrection = r.fields.request_type === 'correction';
    const isNew = r.status === 'New';
    // The request below this one (or above, for the last) gets focus after
    // Mark handled, so the owner can carry on down the list.
    const i = open.indexOf(r);
    const next = open[i + 1] ?? open[i - 1];
    return el('article', { class: `request ${isCorrection ? 'is-correction' : 'is-new-listing'}${isNew ? '' : ' is-handled'}`, 'aria-labelledby': `req-kind-${r.id} req-${r.id}` },
      el('div', { class: 'request-top' },
        el('span', { class: `req-kind ${isCorrection ? 'correction' : 'new-listing'}`, id: `req-kind-${r.id}` }, isCorrection ? 'Correction to a listing' : 'New listing request'),
        el('span', { class: 'req-id' }, `Request #${r.id}`),
        isNew ? null : el('span', { class: 'req-handled' }, 'Handled')),
      el('h2', { id: `req-${r.id}`, tabindex: '-1' }, r.fields.organization || '(no name)'),
      el('p', { class: 'meta-line' }, `Received ${formatDateTime(r.created_at)}`,
        r.status !== 'New' ? ` · Handled ${formatDateTime(r.handled_at)}${r.handled_note ? `: ${r.handled_note}` : ''}` : '',
        r.listing_id ? [' · ', el('a', { href: `#/edit/${encodeURIComponent(r.listing_id)}` }, 'Open the listing')] : null),
      r.email_sent ? null : el('p', { class: 'inline-warn' }, 'Email was not sent; this copy is the only record.'),
      el('dl', {}, REQUEST_LABELS.flatMap(([k, label]) => {
        const v = requestValue(r.fields, k);
        return v ? [el('dt', {}, label), el('dd', {}, v)] : [];
      })),
      isNew ? el('div', { class: 'request-actions' },
        isCorrection
          ? el('p', { class: 'next-step' }, 'Next: ',
            correctionListingId(r.fields.organization)
              ? el('a', { href: `#/edit/${encodeURIComponent(correctionListingId(r.fields.organization))}` }, 'open the listing')
              : el('a', { href: '#/listings', onclick: () => { listFilters.q = correctionListingName(r.fields.organization); } }, 'find the listing'),
            ', call or email to confirm, edit it, then mark this handled.')
          : el('div', { class: 'row' },
            el('button', { type: 'button', onclick: () => {
              sessionStorage.setItem('prefill', JSON.stringify({ requestId: r.id, okToPublish: r.fields.ok_to_publish === true, listing: listingFromRequest(r) }));
              location.hash = '#/new?from-request';
            } }, 'Create listing from this', el('span', { class: 'visually-hidden' }, `: ${r.fields.organization || 'request'}`))),
        el('div', { class: 'toolbar handled-row' },
          el('div', { class: 'field' }, el('label', { for: `note-${r.id}` }, 'Short reason (optional)'), note),
          el('button', { type: 'button', class: 'secondary', onclick: (e) => runAction(e.currentTarget, async () => {
            await api(`/requests/${encodeURIComponent(r.id)}/handled`, { method: 'POST', body: { note: note.value } });
            toast('Marked handled.');
            await viewRequests({ again: next ? `#req-${next.id}` : '.handled summary' });
          }) }, 'Mark handled', el('span', { class: 'visually-hidden' }, `: ${r.fields.organization || 'request'}`)))) : null,
    );
  };

  const page = [
    pageHead('Provider requests'),
    open.length ? el('p', { class: 'lede' }, `${open.length} new. Call or email the provider to confirm details before creating a listing.`) : null,
    open.length ? open.map(card) : emptyState('No new requests', 'When a provider fills in the request form, it shows here and in your email.'),
    handled.length ? el('details', { class: 'handled' }, el('summary', {}, `Handled (${handled.length})`), ...handled.map(card)) : null,
  ];
  if (again) showKeepingPlace({ focus: again }, ...page);
  else show(...page);
}

// ---------- router ----------
// The address of the page on screen, so a cancelled "Leave without saving?"
// puts the address (and the menu) back in step with it.
let shownHash = location.hash || '#/listings';
async function route() {
  const keptAsDraft = Boolean(document.querySelector('.listing-form'));
  if (dirty && !confirm(`You have unsaved changes. Leave without saving?${keptAsDraft ? ' (They are kept on this device: open the listing again to put them back.)' : ''}`)) {
    history.replaceState(null, '', shownHash);
    return;
  }
  pendingDraft?.();
  viewGen++;
  dirty = false;
  const hash = location.hash || '#/listings';
  shownHash = hash;
  try {
    if (hash.startsWith('#/edit/')) await viewEdit(decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/new')) {
      let prefill = null;
      let fromRequest = null;
      let okToPublish = false;
      if (hash.includes('from-request')) {
        try {
          const saved = JSON.parse(sessionStorage.getItem('prefill') || 'null');
          if (saved) { prefill = saved.listing; fromRequest = saved.requestId; okToPublish = saved.okToPublish === true; }
        } catch { /* ignore */ }
      }
      await viewEdit(null, { prefill, fromRequest, okToPublish });
    } else if (hash === '#/recheck') await viewRecheck();
    else if (hash === '#/lists') await viewLists();
    else if (hash === '#/requests') await viewRequests();
    else if (hash === '#/retired') await viewRetired();
    else if (hash === '#/barriers') await viewBarriers();
    else if (hash === '#/suggestions') await viewSuggestions();
    else if (hash === '#/review') await viewReview();
    else if (hash === '#/notice') await viewNotice();
    else await viewListings();
  } catch (err) {
    showError(err);
  }
}

// Export to Excel: downloaded here, so a failure (expired login, no signal)
// shows a message instead of leaving the admin panel for a page of code.
let exporting = false;
document.querySelector('.util-export')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (exporting) return;
  exporting = true;
  const link = e.currentTarget;
  toast('Preparing the Excel file…', { long: true });
  try {
    let res;
    try { res = await fetch(link.href, { credentials: 'same-origin' }); } catch { throw new Error(MSG_OFFLINE); }
    const type = res.headers.get('Content-Type') || '';
    if (res.status === 401 || res.status === 403 || (res.ok && !type.includes('spreadsheetml'))) throw new Error(MSG_LOGIN);
    if (!res.ok) throw new Error(`The export didn't work (error ${res.status}). Please try again in a minute.`);
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'resource-directory.xlsx';
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('Excel file downloaded.');
  } catch (err) {
    toast(err.message, { long: true });
  } finally {
    exporting = false;
  }
});

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try {
    const [{ email }] = await Promise.all([api('/whoami'), loadLists()]);
    document.getElementById('who').textContent = `Logged in as ${email}`;
    api('/pause').then((p) => updatePauseBanner(p.paused)).catch(() => { /* banner is a convenience */ });
    // Waiting count next to "To review" in the menu.
    api('/review').then(({ items }) => {
      setNavCount('review', items.filter((i) => i.status === 'open' && i.kind !== 'info').length);
    }).catch(() => { /* the count is a convenience */ });
    // New provider requests count next to "Requests".
    refreshRequestCount();
    // The old "Help suggestions" menu item starts hidden (so the menu doesn't
    // jump) and only appears while there are still messages, or when the page
    // itself was opened by its address.
    const suggestionsItem = document.querySelector('[data-nav="suggestions"]')?.closest('li');
    if (suggestionsItem && location.hash.startsWith('#/suggestions')) suggestionsItem.hidden = false;
    api('/suggestions').then(({ suggestions }) => {
      if (suggestionsItem && suggestions.length > 0) suggestionsItem.hidden = false;
    }).catch(() => { /* leave the menu item hidden */ });
    await route();
  } catch (err) {
    showError(err);
  }
})();
