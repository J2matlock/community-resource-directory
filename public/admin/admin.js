// Admin panel. Every value from the database or the provider form is shown
// with textContent or input.value, never as HTML (rule 5).

let COUNTIES = ['Regional']; // filled from the server's region settings
const AGE_GROUPS = ['Children', 'Youth 16–24', 'Adults', 'Seniors'];
const COSTS = ['Free', 'Sliding scale', 'Insurance', 'Uninsured OK', 'Private pay'];
const STATUSES = ['Active', 'Temporarily closed', 'Seasonal'];

const main = document.getElementById('main');
let lists = { categories: [], plans: [] };
let dirty = false;

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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 403) throw Object.assign(new Error('Your login has expired. Reload the page to log in again.'), { status: 403 });
  if (!res.ok) throw Object.assign(new Error(data?.error || `Something went wrong (${res.status}).`), { status: res.status, data });
  return data;
}

function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function show(...nodes) {
  main.replaceChildren(...nodes.flat().filter(Boolean));
  main.focus();
}

function showError(err) {
  show(el('h1', {}, 'Something went wrong'), el('p', {}, err.message), el('p', {}, el('button', { type: 'button', onclick: () => location.reload() }, 'Reload')));
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

function badges(l) {
  return [
    l.visibility === 'Internal' ? el('span', { class: 'badge internal' }, 'Internal') : null,
    l.retired ? el('span', { class: 'badge retired' }, 'Retired') : null,
    l.status === 'Temporarily closed' ? el('span', { class: 'badge closed' }, 'Temporarily closed') : null,
    l.status === 'Seasonal' ? el('span', { class: 'badge seasonal' }, 'Seasonal') : null,
  ];
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
    results.replaceChildren(...shown.map((l) => el('li', {},
      el('span', { class: 'name' }, el('a', { href: `#/edit/${l.id}` }, l.name)),
      el('span', { class: 'info' }, badges(l), [l.category, l.town].filter(Boolean).join(' · ')),
      el('span', { class: 'info' }, l.last_verified ? `Verified ${formatDate(l.last_verified)}` : 'Not yet verified'),
    )));
  }

  const search = el('input', { type: 'search', id: 'list-search', value: listFilters.q, oninput: (e) => { listFilters.q = e.target.value; render(); } });
  const vis = el('select', { id: 'list-vis', onchange: (e) => { listFilters.visibility = e.target.value; render(); } },
    el('option', { value: '' }, 'Public and Internal'), el('option', { value: 'Public' }, 'Public only'), el('option', { value: 'Internal' }, 'Internal only'));
  vis.value = listFilters.visibility;
  const cat = el('select', { id: 'list-cat', onchange: (e) => { listFilters.category = e.target.value; render(); } },
    el('option', { value: '' }, 'All categories'), ...lists.categories.map((c) => el('option', { value: c }, c)));
  cat.value = listFilters.category;

  show(
    el('h1', {}, 'Listings'),
    el('p', {}, el('a', { href: '#/new', class: 'button' }, '+ Add a listing')),
    el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'list-search' }, 'Search'), search),
      el('div', { class: 'field' }, el('label', { for: 'list-vis' }, 'Visibility'), vis),
      el('div', { class: 'field' }, el('label', { for: 'list-cat' }, 'Category'), cat),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: listFilters.retired, onchange: (e) => { listFilters.retired = e.target.checked; render(); } }), 'Show retired'),
    ),
    count,
    results,
  );
  render();
}

// ---------- Edit / Add view ----------
const TEXT_FIELDS = [
  ['name', 'Name', 'text', 'Organization or program name. Required.'],
  ['organization', 'Parent organization', 'text', 'Groups programs from the same agency, e.g. "Open Door Mission".'],
];

function textField(name, label, type, hint, value, opts = {}) {
  const id = `f-${name}`;
  const input = type === 'textarea'
    ? el('textarea', { id, name, rows: opts.rows ?? 4, 'aria-describedby': `${id}-hint ${id}-err` })
    : el('input', { id, name, type, 'aria-describedby': `${id}-hint ${id}-err`, autocomplete: 'off' });
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
  return el('fieldset', { 'data-field': name, 'aria-describedby': `${id}-err` },
    el('legend', {}, legend, hint ? el('span', { class: 'hint' }, hint) : null),
    el('div', { class: 'checks' }, ...options.map((o) => el('label', {},
      el('input', { type: 'checkbox', name, value: o, checked: selected.includes(o) }), o))),
    el('p', { class: 'error-text', id: `${id}-err`, hidden: true }),
  );
}

function selectField(name, label, options, value, hint) {
  const id = `f-${name}`;
  const sel = el('select', { id, name, 'aria-describedby': `${id}-hint ${id}-err` },
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
    confirm_office_address: form.elements.confirm_office_address?.checked === true,
  };
}

function clearErrors(form) {
  for (const f of form.querySelectorAll('[data-field]')) {
    f.classList.remove('invalid');
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

async function viewEdit(id, { prefill = null, fromRequest = null, okToPublish = false } = {}) {
  setNav('listings');
  let listing = null;
  let history = [];
  if (id) {
    const data = await api(`/listings/${encodeURIComponent(id)}`);
    listing = data.listing;
    history = data.history;
  }
  const l = listing ?? {
    name: '', organization: '', category: lists.categories[0] ?? '', tags: [], phone: '', fax: '', email: '', website: '',
    address: '', town: '', serves_counties: [], hours: '', eligibility: '', age_groups: [], cost: [], medicaid_plans: [],
    medicaid_notes: '', description: '', private_notes: '', status: 'Active', review_by: '', visibility: 'Public', last_verified: '',
    ...(prefill ?? {}),
  };
  document.title = `${id ? `Edit: ${l.name}` : 'Add a listing'}: Directory admin`;

  const form = el('form', { novalidate: true, 'aria-label': id ? 'Edit listing' : 'Add listing' },
    textField('name', 'Name', 'text', 'Organization or program name. Required.', l.name),
    textField('organization', 'Parent organization', 'text', 'Groups programs from the same agency, e.g. "Open Door Mission".', l.organization),
    selectField('category', 'Category', l.category ? lists.categories : ['', ...lists.categories], l.category, 'Add or rename categories under "Categories & plans".'),
    textField('tags', 'Search words', 'text', 'Separate with commas, e.g. food pantry, groceries.', l.tags.join(', ')),
    el('div', { class: 'grid2' },
      textField('phone', 'Phone', 'tel', 'General line only, e.g. (518) 555-1234 x12. Staff direct lines go in private notes.', l.phone),
      textField('fax', 'Fax', 'tel', '', l.fax)),
    el('div', { class: 'grid2' },
      textField('email', 'Email', 'email', 'General address only. A staff member\'s email goes in private notes.', l.email),
      textField('website', 'Website', 'url', 'e.g. https://example.org', l.website)),
    textField('address', 'Office address', 'text', 'Street, town, NY ZIP. Leave blank if there is no public address.', l.address),
    el('div', { class: 'field', 'data-field': 'confirm_office_address' },
      el('div', { class: 'checks' }, el('label', {}, el('input', { type: 'checkbox', name: 'confirm_office_address' }),
        'This is an office address, not a shelter')),
      el('span', { class: 'hint' }, 'Needed for domestic violence programs. Never store where a shelter is.')),
    textField('town', 'Town', 'text', 'Filled in from the address if left blank.', l.town),
    checkGroup('serves_counties', 'Counties served', COUNTIES, l.serves_counties, 'Regional = shows for every county.'),
    textField('hours', 'Hours', 'text', 'e.g. Monday–Friday, 9 AM–4 PM', l.hours),
    textField('eligibility', 'Who can get help', 'textarea', 'e.g. "60+ or have a disability"', l.eligibility, { rows: 2 }),
    checkGroup('age_groups', 'Age groups', AGE_GROUPS, l.age_groups, 'Leave all unticked if open to all ages.'),
    checkGroup('cost', 'Cost', COSTS, l.cost),
    checkGroup('medicaid_plans', 'Insurance accepted', lists.plans, l.medicaid_plans, 'Tick only plans you have confirmed. Add plans under "Categories & plans".'),
    textField('medicaid_notes', 'Insurance notes', 'text', 'e.g. "Does not take UnitedHealthcare Medicaid"', l.medicaid_notes),
    textField('description', 'Description (public)', 'textarea', 'Plain summary anyone can understand.', l.description, { rows: 5 }),
    textField('private_notes', 'Private notes', 'textarea', 'Staff names, direct lines, scripts, intake tips. Never shown publicly. Never put client information here.', l.private_notes, { rows: 5, private: true }),
    el('div', { class: 'grid2' },
      selectField('status', 'Status', STATUSES, l.status),
      textField('review_by', 'Re-check by', 'date', 'Optional date to check this listing again.', l.review_by)),
    el('fieldset', { 'data-field': 'visibility' },
      el('legend', {}, 'Visibility'),
      el('div', { class: 'checks' },
        el('label', {}, el('input', { type: 'radio', name: 'visibility', value: 'Public', checked: l.visibility === 'Public' }), 'Public'),
        el('label', {}, el('input', { type: 'radio', name: 'visibility', value: 'Internal', checked: l.visibility === 'Internal' }), 'Internal (only you see the whole listing)')),
      el('p', { class: 'error-text', id: 'f-visibility-err', hidden: true })),
    textField('last_verified', 'Last verified', 'date', 'Use "Verified today" below to set this to today.', l.last_verified),
  );

  form.addEventListener('input', () => { dirty = true; });

  async function save(confirmWarnings = false) {
    const body = { ...readForm(form), confirm_warnings: confirmWarnings };
    if (listing) body.expected_updated_at = listing.updated_at;
    if (fromRequest) body.from_request_id = fromRequest;
    try {
      const res = listing
        ? await api(`/listings/${encodeURIComponent(listing.id)}`, { method: 'PUT', body })
        : await api('/listings', { method: 'POST', body });
      dirty = false;
      if (fromRequest) sessionStorage.removeItem('prefill');
      toast(fromRequest ? 'Saved. The request is marked handled.' : 'Saved.');
      location.hash = `#/edit/${res.listing.id}`;
      if (listing) await viewEdit(res.listing.id);
    } catch (err) {
      if (err.status === 422 && err.data) showProblems(form, err.data, () => save(true));
      else if (err.status === 409) showProblems(form, { error: err.message, errors: {} });
      else showProblems(form, { error: err.message, errors: {} });
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });

  const actions = el('div', { class: 'actions-bar' },
    el('button', { type: 'submit' }, id ? 'Save changes' : 'Add listing'),
    listing ? el('button', { type: 'button', class: 'secondary', onclick: async () => {
      if (dirty) { toast('Save or undo your changes first.'); return; }
      await api(`/listings/${encodeURIComponent(listing.id)}/verify`, { method: 'POST' });
      toast('Marked as verified today.');
      await viewEdit(listing.id);
    } }, 'Verified today') : null,
    listing ? el('button', { type: 'button', class: listing.retired ? 'secondary' : 'danger', onclick: async () => {
      if (dirty) { toast('Save or undo your changes first.'); return; }
      await api(`/listings/${encodeURIComponent(listing.id)}/${listing.retired ? 'restore' : 'retire'}`, { method: 'POST' });
      toast(listing.retired ? 'Restored. It shows on the public site again.' : 'Retired. It no longer shows on the public site.');
      await viewEdit(listing.id);
    } }, listing.retired ? 'Restore' : 'Retire') : null,
    el('a', { href: '#/listings', class: 'button secondary' }, 'Back to list'),
  );
  form.append(actions);

  const head = [
    el('h1', {}, id ? l.name : 'Add a listing'),
    listing ? el('p', { class: 'meta-line' }, badges(listing),
      listing.visibility === 'Public' && !listing.retired ? el('a', { href: `/listing/${listing.id}` }, 'View on public site') : 'Not shown on the public site',
      ` · Link name: ${listing.id}`) : null,
    fromRequest ? el('div', { class: 'summary warn' },
      el('p', {}, `Pre-filled from provider request #${fromRequest}. Choose a category and check everything, then save. The request will be marked handled.`),
      el('p', {}, okToPublish
        ? 'The provider said it is OK to publish. The listing starts as Internal; switch it to Public once you have confirmed the details.'
        : 'The provider did NOT say it is OK to publish. Keep it Internal unless they agree.')) : null,
  ];

  const historySection = listing ? [
    el('h2', {}, 'Change history'),
    history.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'history' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'When'), el('th', { scope: 'col' }, 'Field'), el('th', { scope: 'col' }, 'Before'), el('th', { scope: 'col' }, 'After'))),
      el('tbody', {}, history.map((h) => el('tr', {},
        el('td', {}, formatDateTime(h.changed_at)), el('td', {}, h.field.replace(/_/g, ' ')),
        el('td', {}, h.old_value), el('td', {}, h.new_value)))))) : el('p', {}, 'No changes yet.'),
  ] : [];

  dirty = false;
  show(...head, form, ...historySection);
}

// ---------- Due for re-check ----------
async function viewRecheck() {
  setNav('recheck');
  document.title = 'Due for re-check: Directory admin';
  const { listings } = await api('/recheck');
  const today = new Date().toISOString().slice(0, 10);
  const reason = (l) => {
    if (l.review_by && l.review_by <= today) return `Re-check date ${formatDate(l.review_by)} has passed`;
    if (!l.last_verified) return 'Never verified';
    return `Last verified ${formatDate(l.last_verified)}`;
  };
  const list = el('ul', { class: 'items' }, listings.map((l) => {
    const li = el('li', {},
      el('span', { class: 'name' }, el('a', { href: `#/edit/${l.id}` }, l.name)),
      el('span', { class: 'info' }, badges(l), reason(l), l.phone ? ` · ${l.phone}` : ''),
      el('button', { type: 'button', class: 'secondary', onclick: async (e) => {
        e.target.disabled = true;
        await api(`/listings/${encodeURIComponent(l.id)}/verify`, { method: 'POST' });
        li.remove();
        toast(`${l.name}: verified today.`);
      } }, 'Verified today'));
    return li;
  }));
  show(
    el('h1', {}, 'Due for re-check'),
    el('p', {}, `${listings.length} listings were never verified, were last verified over 11 months ago, or have a re-check date that has passed. Call or email them, then press "Verified today" or edit the listing.`),
    list,
  );
}

// ---------- Retired (archive) ----------
async function viewRetired() {
  setNav('retired');
  document.title = 'Retired: Directory admin';
  const { listings } = await api('/listings');
  const retired = listings.filter((l) => l.retired);
  const list = el('ul', { class: 'items' }, retired.map((l) => {
    const li = el('li', {},
      el('span', { class: 'name' }, el('a', { href: `#/edit/${l.id}` }, l.name)),
      el('span', { class: 'info' }, [l.category, l.town].filter(Boolean).join(' · ')),
      el('button', { type: 'button', class: 'secondary', onclick: async (e) => {
        e.target.disabled = true;
        await api(`/listings/${encodeURIComponent(l.id)}/restore`, { method: 'POST' });
        li.remove();
        toast(`${l.name}: restored to the public directory.`);
      } }, 'Restore'));
    return li;
  }));
  show(
    el('h1', {}, 'Retired listings'),
    el('p', {}, `${retired.length} retired (archived) listings. They are hidden from the public site but kept here with their history. Open one to see or edit it, or press Restore to put it back.`),
    list,
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
  show(
    el('h1', {}, 'Barrier reports'),
    el('p', {}, `${reports.length} anonymous reports. Comments are only visible here. The public page shows totals only, and hides any number under 5.`),
    el('h2', {}, 'All reports by barrier (exact counts, admin only)'),
    el('ul', { class: 'items' }, top.map(([b, n]) => el('li', {}, el('span', { class: 'name' }, labels[b] || b), el('span', { class: 'info' }, String(n))))),
    el('h2', {}, 'Latest reports'),
    el('ul', { class: 'items' }, reports.map((r) => el('li', {},
      el('span', { class: 'name' }, `${formatDateTime(r.created_at)} · ${r.county}${r.reporter ? ` · ${r.reporter}` : ''}`),
      el('span', { class: 'info' }, r.barriers.map((b) => labels[b] || b).join('; ')),
      r.comment ? el('span', { class: 'info' }, `Comment: ${r.comment}`) : null))),
  );
}

// ---------- "Don't see the help you need?" messages (anonymous) ----------
async function viewSuggestions() {
  setNav('suggestions');
  document.title = 'Help suggestions: Directory admin';
  const { suggestions } = await api('/suggestions');
  show(
    el('h1', {}, 'Help suggestions'),
    el('p', {}, `${suggestions.length} anonymous messages from "Don't see the help you need?". Only you see these. Ideas for new categories or listings.`),
    suggestions.length
      ? el('ul', { class: 'items' }, suggestions.map((r) => el('li', {},
        el('span', { class: 'name' }, `${formatDateTime(r.created_at)}${r.county ? ` · ${r.county}` : ''}`),
        el('span', { class: 'info' }, r.looking_for))))
      : el('p', {}, 'No messages yet.'),
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
      const input = el('input', { type: 'text', value: item.name, 'aria-label': `New name for ${item.name}` });
      return el('li', {},
        el('span', { class: 'grow' }, input),
        el('span', { class: 'info' }, `${item.used} listing${item.used === 1 ? '' : 's'}`),
        el('button', { type: 'button', class: 'secondary', onclick: async () => {
          try {
            const r = await api(`/lists/${kind}/${encodeURIComponent(item.name)}`, { method: 'PUT', body: { name: input.value } });
            draw(r.items); await loadLists(); toast('Renamed. Listings using it were updated.');
          } catch (err) { toast(err.message); }
        } }, 'Rename'),
        el('button', { type: 'button', class: 'danger', disabled: item.used > 0, title: item.used ? 'In use; rename instead, or change those listings first.' : null, onclick: async () => {
          try {
            const r = await api(`/lists/${kind}/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
            draw(r.items); await loadLists(); toast('Removed.');
          } catch (err) { toast(err.message); }
        } }, 'Remove'));
    }));
    draw(items);
    const addInput = el('input', { type: 'text', id: `add-${kind}` });
    return [
      el('h2', {}, title),
      el('p', { class: 'hint' }, help),
      ul,
      el('form', { class: 'toolbar', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api(`/lists/${kind}`, { method: 'POST', body: { name: addInput.value } });
          addInput.value = ''; draw(r.items); await loadLists(); toast('Added.');
        } catch (err) { toast(err.message); }
      } },
      el('div', { class: 'field' }, el('label', { for: `add-${kind}` }, `Add a ${kind === 'plans' ? 'plan' : 'category'}`), addInput),
      el('button', { type: 'submit' }, 'Add')),
    ];
  }

  show(
    el('h1', {}, 'Categories & insurance plans'),
    ...section('categories', 'Categories', c.items, 'Renaming updates every listing in that category. A category in use can\'t be removed.'),
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
  if (key === 'ok_to_publish') return f.ok_to_publish ? 'Yes' : 'No';
  const v = f[key];
  return Array.isArray(v) ? v.join(', ') : v;
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

async function viewRequests() {
  setNav('requests');
  document.title = 'Requests: Directory admin';
  let data;
  try {
    data = await api('/requests');
  } catch (err) {
    if (err.status === 404) { show(el('h1', {}, 'Requests'), el('p', {}, 'The provider request form is not set up yet (Phase 5).')); return; }
    throw err;
  }
  const { requests } = data;
  const open = requests.filter((r) => r.status === 'New');
  const handled = requests.filter((r) => r.status !== 'New');

  const card = (r) => {
    const note = el('input', { type: 'text', id: `note-${r.id}`, placeholder: 'e.g. Declined: outside our area' });
    return el('article', { class: 'request', 'aria-labelledby': `req-${r.id}` },
      el('h2', { id: `req-${r.id}` }, `#${r.id}: ${r.fields.request_type === 'correction' ? 'Correction to ' : ''}${r.fields.organization || '(no name)'}`),
      el('p', { class: 'meta-line' }, `Received ${formatDateTime(r.created_at)}`, r.email_sent ? '' : ' · Email was not sent; this copy is the only record',
        r.status !== 'New' ? ` · Handled ${formatDateTime(r.handled_at)}${r.handled_note ? `: ${r.handled_note}` : ''}` : ''),
      el('dl', {}, REQUEST_LABELS.flatMap(([k, label]) => {
        const v = requestValue(r.fields, k);
        return v ? [el('dt', {}, label), el('dd', {}, v)] : [];
      })),
      r.status === 'New' ? el('div', {},
        r.fields.request_type === 'correction'
          ? el('p', { class: 'hint' }, 'Correction request: find the listing in Listings, call or email to confirm, edit it, then mark this handled.')
          : el('div', { class: 'row' },
            el('button', { type: 'button', onclick: () => {
              sessionStorage.setItem('prefill', JSON.stringify({ requestId: r.id, okToPublish: r.fields.ok_to_publish === true, listing: listingFromRequest(r) }));
              location.hash = '#/new?from-request';
            } }, 'Create listing from this')),
        el('div', { class: 'toolbar' },
          el('div', { class: 'field' }, el('label', { for: `note-${r.id}` }, 'Short reason (optional)'), note),
          el('button', { type: 'button', class: 'secondary', onclick: async () => {
            await api(`/requests/${encodeURIComponent(r.id)}/handled`, { method: 'POST', body: { note: note.value } });
            toast('Marked handled.');
            viewRequests();
          } }, 'Mark handled'))) : null,
    );
  };

  show(
    el('h1', {}, 'Provider requests'),
    el('p', {}, `${open.length} new. Call or email the provider to confirm details before creating a listing.`),
    ...open.map(card),
    handled.length ? el('details', {}, el('summary', {}, `Handled (${handled.length})`), ...handled.map(card)) : null,
  );
}

// ---------- router ----------
async function route() {
  if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
  dirty = false;
  const hash = location.hash || '#/listings';
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
    else await viewListings();
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try {
    const [{ email }] = await Promise.all([api('/whoami'), loadLists()]);
    document.getElementById('who').textContent = `Logged in as ${email}`;
    await route();
  } catch (err) {
    showError(err);
  }
})();
