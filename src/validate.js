// Checks and cleans listing input from the admin panel before it is saved.
// Returns { value, errors, warnings }. Errors block the save; warnings block
// it until the owner confirms ("Save anyway").

import { REGION } from './region.js';
import {
  COUNTIES, AGE_GROUPS, COSTS, STATUSES, VISIBILITIES,
  formatPhone, isHttpUrl, EMAIL_PATTERN, privateTextHits, findTown, slugify,
} from './lib/listing-rules.js';

const TEXT_LIMITS = {
  name: 200, organization: 200, phone: 40, fax: 40, email: 200, website: 500,
  address: 300, town: 80, hours: 500, eligibility: 1000, medicaid_notes: 1000,
  description: 4000, private_notes: 10000,
};

const PUBLIC_TEXT = ['name', 'organization', 'phone', 'fax', 'email', 'website', 'address', 'town',
  'hours', 'eligibility', 'medicaid_notes', 'description'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date as YYYY-MM-DD. Date.parse alone lets "2026-02-30"
// through (it rolls over to March 2), so the date is rebuilt and compared.
function isRealDate(s) {
  if (typeof s !== 'string' || !DATE.test(s) || Number.isNaN(Date.parse(s))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Rule 1: things that are real client details, not templates.
const CLIENT_INFO = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/, what: 'a Social Security number' },
  { re: /\b(DOB|D\.O\.B\.?|date of birth)\s*[:\-]?\s*\d/i, what: 'a date of birth' },
  { re: /\b(MRN|medical record (no|number|#))\s*[:#]?\s*\d/i, what: 'a medical record number' },
  { re: /\b[A-Z]{2}\d{5}[A-Z]\b/, what: 'a Medicaid ID number' },
];

const DV_PATTERN = /domestic violence|\bDV\b|intimate partner|relationship abuse/i;
// Wording that gives where a shelter or safe house is.
const SHELTER_LOCATION = /\b(shelter|safe ?house|safehouse|safe ?home)\b[^.\n]{0,40}(\b(located|location|address|is at|is on|on [A-Z0-9]|at \d)|\b\d{1,5}\s+[A-Z])/i;
const STREET_ADDRESS = /\b\d{1,5}\s+([A-Z][a-z]+\s+){1,3}(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Pl|Place|Ct|Court|Hwy|Route|Rte)\b/;
// Also wording that places a home ("the house is located on Ridge Rd", but not
// "keep your home address private") and a
// street address typed in any case ("22 maple ave"), for domestic violence text.
const HOME_LOCATION = /\b(house|home|residence|apartment)\b[^.\n]{0,30}\b(is|are) located\b/i;
// Lowercase street addresses; "court", "way", "place" and "route" are left out
// here, since "1 family court" or "3 counties along route 9" are ordinary wording.
const STREET_ANY_CASE = /\b\d{1,5}\s+([a-z]+\s+){1,3}(st|street|ave|avenue|rd|road|drive|ln|lane|blvd|boulevard|hwy)\b/i;
function dvPlace(text) {
  return SHELTER_LOCATION.test(text) || STREET_ADDRESS.test(text) || STREET_ANY_CASE.test(text) || HOME_LOCATION.test(text);
}

export function cleanText(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v)
    .replace(/\r\n?/g, '\n')
    // Drop control characters except newline and tab.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return s.length > max ? null : s;
}

function cleanList(v, allowed, field, errors, { max = 30, itemMax = 60 } = {}) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) { errors[field] = 'Must be a list.'; return []; }
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') { errors[field] = 'Must be a list of words.'; return []; }
    const s = item.trim();
    if (!s) continue;
    if (s.length > itemMax) { errors[field] = `Each entry must be ${itemMax} characters or fewer.`; return []; }
    if (allowed && !allowed.includes(s)) { errors[field] = `"${s}" is not one of the choices.`; return []; }
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > max) { errors[field] = `No more than ${max} entries.`; return []; }
  return out;
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// A web address read as words: "/shelter/12-elm-street" -> "shelter 12 elm street".
function urlAsText(url) {
  return decodeURIComponentSafe(String(url || '')).replace(/[-_+/?&=.#]+/g, ' ');
}

const MAP_HOSTS = /(^|\.)(maps\.google\.[a-z.]+|google\.[a-z.]+|goo\.gl|g\.co|maps\.app\.goo\.gl|openstreetmap\.org|waze\.com|bing\.com|mapquest\.com|apple\.com|here\.com)$/i;
const STREET_WORDS = /\b\d{1,5}\s+([a-z]+\s+){1,3}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|pl|place|ct|court|hwy|route|rte)\b/i;
const COORDS = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|[?&](ll|mlat|mlon|lat|lon|lng|q)=/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Rule 2 for sources: a DV program's sources may only be its own website or a
// government site, and never point to or name a place.
function dvSourceAllowed(s, website) {
  const h = hostOf(s.url);
  const own = hostOf(website);
  const ownSite = own && (h === own || h.endsWith(`.${own}`));
  const gov = /(\.gov|\.ny\.us)$/.test(h);
  if (!ownSite && !gov) return false;
  if (MAP_HOSTS.test(h) || /\/maps?\b/i.test(s.url)) return false;
  const text = `${s.label} ${urlAsText(s.url)}`;
  return !(SHELTER_LOCATION.test(text) || STREET_ADDRESS.test(text) || STREET_WORDS.test(text) || COORDS.test(decodeURIComponentSafe(s.url)));
}

// Public sources: up to 3 links that back up a listing's details, each
// {url, label, seen}. Shown on the card as "Source", so they are public text.
export function cleanSources(raw, errors) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) { errors.sources = 'Must be a list.'; return []; }
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.sources = 'Each source needs a web address.'; return []; }
    const url = cleanText(item.url, 500);
    const label = cleanText(item.label, 120);
    const seen = cleanText(item.seen, 10);
    if (url === null || label === null || seen === null) { errors.sources = 'Keep each web address under 500 characters and each label under 120.'; return []; }
    if (!url && !label) continue;
    const u = normalizeWebsite(url);
    let parsed = null;
    try { parsed = u ? new URL(u) : null; } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      errors.sources = `"${url || label}" needs a full web address starting with https://`; return [];
    }
    if (seen && !isRealDate(seen)) { errors.sources = 'Use a date like 2026-10-11 for when you saw a source.'; return []; }
    out.push({ url: u, label, seen });
  }
  if (out.length > 3) { errors.sources = 'Up to 3 sources.'; return []; }
  return out;
}

export function normalizeWebsite(s) {
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  return isHttpUrl(withScheme) ? withScheme : null;
}

/**
 * @param {object} input  raw JSON from the admin form
 * @param {{categories: string[], plans: string[]}} lists  managed lists
 * @param {{confirmedAddress?: string}} opts  the saved address of a listing whose
 *   office address was already confirmed
 */
export function validateListing(input, lists, opts = {}) {
  const errors = {};
  const warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: { _form: 'Expected a listing.' }, warnings };
  }

  const v = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const s = cleanText(input[field], max);
    if (s === null) errors[field] = `Must be text of ${max} characters or fewer.`;
    v[field] = s ?? '';
  }

  if (!v.name && !errors.name) errors.name = 'Name is required.';

  if (typeof input.category !== 'string' || !lists.categories.includes(input.category)) {
    errors.category = 'Choose a category from the list.';
  }
  v.category = typeof input.category === 'string' ? input.category : '';

  for (const f of ['phone', 'fax']) {
    if (!v[f] || errors[f]) continue;
    const p = formatPhone(v[f]);
    if (p === null) errors[f] = 'Use a 10-digit number like (518) 555-1234, with "x12" for an extension.';
    else v[f] = p;
  }

  if (v.email && !errors.email) {
    v.email = v.email.toLowerCase();
    if (!EMAIL_PATTERN.test(v.email)) errors.email = 'This doesn\'t look like an email address.';
  }

  if (v.website && !errors.website) {
    const w = normalizeWebsite(v.website);
    if (w === null) errors.website = 'Use a full web address starting with https://';
    else v.website = w;
  }

  if (!v.town && v.address) v.town = findTown(v.address);

  v.tags = cleanList(input.tags, null, 'tags', errors, { max: 30, itemMax: 40 }).map((t) => t.toLowerCase());
  v.serves_counties = cleanList(input.serves_counties, COUNTIES, 'serves_counties', errors);
  v.age_groups = cleanList(input.age_groups, AGE_GROUPS, 'age_groups', errors);
  v.cost = cleanList(input.cost, COSTS, 'cost', errors);
  v.medicaid_plans = cleanList(input.medicaid_plans, lists.plans, 'medicaid_plans', errors);

  v.status = input.status ?? 'Active';
  if (!STATUSES.includes(v.status)) errors.status = 'Choose a status from the list.';
  v.visibility = input.visibility ?? 'Public';
  if (!VISIBILITIES.includes(v.visibility)) errors.visibility = 'Choose Public or Internal.';

  for (const f of ['review_by', 'last_verified', 'last_checked_online']) {
    const s = input[f] ?? '';
    if (s !== '' && !isRealDate(s)) {
      errors[f] = 'Use a date like 2027-01-31.';
      v[f] = '';
    } else {
      v[f] = s;
    }
  }

  v.sources = cleanSources(input.sources, errors);

  // Rule 1: no client information anywhere, including private notes.
  for (const f of [...Object.keys(TEXT_LIMITS), 'tags', 'sources']) {
    const text = f === 'sources' ? v.sources.map((s) => `${s.label} ${urlAsText(s.url)}`).join(' ') : Array.isArray(v[f]) ? v[f].join(' ') : v[f];
    for (const c of CLIENT_INFO) {
      if (c.re.test(text)) {
        errors[f] = `This looks like ${c.what}. Client information must never be stored here.`;
        break;
      }
    }
  }

  // Rule 2: domestic violence programs keep an office address only.
  const dvText = [v.name, v.organization, v.category, v.description, v.tags.join(' ')].join(' ');
  // The "office address" tick covers the address box only, and once an
  // address is confirmed it stays confirmed until the address changes.
  const isDv = DV_PATTERN.test(dvText);
  const addressConfirmed = input.confirm_office_address === true || (opts.confirmedAddress !== undefined && opts.confirmedAddress === v.address);
  if (isDv && v.address && !addressConfirmed) {
    errors.address = 'This looks like a domestic violence program. Only an office address may be stored, never a shelter location. Tick "This is an office address, not a shelter" to save it, or clear the address.';
  }
  if (isDv) {
    for (const f of Object.keys(TEXT_LIMITS)) {
      if (f === 'address' || errors[f]) continue;
      if (dvPlace(v[f])) {
        errors[f] = 'On a domestic violence program, put the office address only in the address box. Never store a shelter\'s location, in any field, even private notes.';
      }
    }
    if (!errors.sources && v.sources.some((s) => !dvSourceAllowed(s, v.website))) {
      errors.sources = 'On a domestic violence program, sources must be the program\'s own website or a government site, and must not point to or name a location (no map links, coordinates or street addresses).';
    }
  }

  // Private-looking text in public fields: warn, unless the listing is Internal.
  if (v.visibility === 'Public') {
    for (const f of PUBLIC_TEXT) {
      for (const hit of privateTextHits(v[f])) {
        warnings.push(`${f.replace('_', ' ')} mentions ${hit}. Private details belong in private notes.`);
      }
    }
    for (const hit of privateTextHits(v.sources.map((s) => `${s.label} ${urlAsText(s.url)}`).join(' '))) {
      warnings.push(`sources mention ${hit}. Private details belong in private notes.`);
    }
    if (v.sources.some((s) => /[?&](utm_[a-z]+|fbclid|gclid|mc_eid)=/i.test(s.url))) {
      warnings.push('A source link has tracking tags (like utm_ or fbclid). Remove everything after the "?" if the page still loads without it.');
    }
  }

  return { value: Object.keys(errors).length ? null : v, errors, warnings };
}

// ---- "To review" answers (admin only) ----

export const REVIEW_STATUSES = {
  check: ['open', 'done', 'dismissed'],
  call: ['open', 'done', 'dismissed'],
  task: ['open', 'done', 'dismissed'],
  decision: ['open', 'yes', 'later', 'no'],
  idea: ['open', 'yes', 'later', 'no'],
  fyi: ['open', 'ok', 'change'],
  info: ['open'], // reference only (the review report); nothing to answer
};

/** Checks the owner's answer to a review item. Notes are private but still never hold client information. */
export function validateReviewAnswer(kind, input, { dv = false } = {}) {
  const allowed = REVIEW_STATUSES[kind];
  if (!allowed) return { value: null, error: 'Unknown item.' };
  const status = input?.status;
  if (typeof status !== 'string' || !allowed.includes(status)) return { value: null, error: 'Choose one of the buttons.' };
  const note = cleanText(input?.note ?? '', 2000);
  if (note === null) return { value: null, error: 'Keep the note under 2,000 characters.' };
  const unsafe = unsafeStoredText(note, { dv, anyShelter: true });
  if (unsafe) return { value: null, error: unsafe };
  return { value: { status, note }, error: null };
}

/**
 * Rules 1 and 2 for text kept anywhere (review notes, seeded review items):
 * returns why it can't be stored, or ''. `dv` also refuses street addresses.
 */
export function unsafeStoredText(text, { dv = false, anyShelter = false } = {}) {
  for (const c of CLIENT_INFO) {
    if (c.re.test(text)) return `This looks like ${c.what}. Client information must never be stored.`;
  }
  // Shelter-location wording is checked whenever the item or text is about
  // domestic violence (rule 2), and always in the owner's notes (anyShelter).
  // Seeded text about a homeless shelter's public address is fine.
  const aboutDv = dv || anyShelter || DV_PATTERN.test(text) || /\babuse|survivor/i.test(text);
  if ((aboutDv && SHELTER_LOCATION.test(text)) || (dv && dvPlace(text))) {
    return 'Never store a domestic violence shelter\'s location, even in notes.';
  }
  return '';
}

/** True if a saved listing looks like a domestic violence program. */
export function isDvListing(l) {
  return DV_PATTERN.test([l.name, l.organization, l.category, l.description, (l.tags || []).join(' ')].join(' '));
}

export function makeListingId(name, taken) {
  const base = slugify(name) || 'listing';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function validateListName(raw) {
  const s = cleanText(raw, 80);
  if (!s) return { value: null, error: 'Enter a name of 80 characters or fewer.' };
  for (const c of CLIENT_INFO) {
    if (c.re.test(s)) return { value: null, error: `This looks like ${c.what}. Client information must never be stored.` };
  }
  return { value: s, error: null };
}

// ---- Provider request form (rule 5: untrusted input) ----

// The public form takes corrections only (owner decision, 2026-10-12): which
// listing, and what to fix. No name, contact details or other free text.
const REQUEST_TEXT = { organization: [200, true], correction: [3000, true] };

export function validateProviderRequest(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the form fields.' } };
  if (input.request_type !== undefined && input.request_type !== 'correction') {
    errors.request_type = 'This form is for corrections only. To ask for a new listing, email the support address on this page.';
  }
  // Only the two correction fields are kept; anything else sent is ignored and never stored.
  const v = { request_type: 'correction' };
  for (const [field, [max, required]] of Object.entries(REQUEST_TEXT)) {
    const s = cleanText(input[field], max);
    if (s === null) errors[field] = `Please keep this under ${max} characters.`;
    else if (required && !s) errors[field] = 'Please fill this in.';
    v[field] = s ?? '';
  }

  // Rule 2: a correction can name a DV program without saying so; never accept a shelter location.
  if (!errors.correction && SHELTER_LOCATION.test(v.correction)) {
    errors.correction = 'Please don\'t include a shelter location. Office addresses only.';
  }
  if (DV_PATTERN.test(`${v.organization} ${v.correction}`)) {
    for (const f of Object.keys(REQUEST_TEXT)) {
      if (!errors[f] && dvPlace(v[f])) {
        errors[f] = 'Please don\'t include a shelter location or street address for a domestic violence program.';
      }
    }
  }

  // Rule 1: client information has no place in a correction.
  for (const f of Object.keys(REQUEST_TEXT)) {
    if (CLIENT_INFO.some((c) => c.re.test(v[f]))) errors[f] = 'Please don\'t include personal details about yourself or the people you serve.';
  }
  return { value: Object.keys(errors).length ? null : v, errors };
}

// ---------- One-tap "This didn't work" reports (anonymous, tap-only) ----------
export const REPORT_REASONS = [
  ['phone', 'The phone number didn\'t work'],
  ['closed', 'Closed or moved'],
  ['full', 'Not taking new people'],
];

export function validateListingReport(input) {
  const errors = {};
  const id = input?.listing_id;
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id)) errors.listing_id = 'Unknown listing.';
  const reason = input?.reason;
  if (!REPORT_REASONS.some(([r]) => r === reason)) errors.reason = 'Please choose one of the buttons.';
  return { value: Object.keys(errors).length ? null : { listing_id: id, reason }, errors };
}

// ---------- Anonymous barrier reports (Community needs page) ----------
// A fixed list, so totals can be shown publicly without free text.
export const BARRIERS = [
  ['transportation', 'Getting a ride or bus to appointments, work or shopping'],
  ['procedure_escort', 'No one to drive me home and stay after a procedure with anesthesia or sedation'],
  ['housing_cost', 'Rent or housing costs too much'],
  ['homeless', 'No safe place to stay / shelter full or far away'],
  ['home_repair', 'Can\'t afford home repairs or accessibility changes'],
  ['utilities', 'Heating, electric or other utility bills'],
  ['food', 'Not enough food'],
  ['child_care', 'Child care costs or no openings'],
  ['dental', 'Finding a dentist who takes my insurance'],
  ['medical', 'Finding a doctor or specialist who takes my insurance'],
  ['mental_health', 'Getting mental health care (wait times, no openings)'],
  ['substance_use', 'Getting help for alcohol or drug use'],
  ['home_care', 'Getting home care aides or help at home'],
  ['disability', 'Disability services or equipment'],
  ['paperwork', 'Applications, paperwork, IDs or benefits are too confusing'],
  ['internet_phone', 'No phone, internet or computer access'],
  ['legal', 'Legal help'],
  ['jobs', 'Finding work or job training'],
  ['isolation', 'Loneliness or no one to help'],
  ['other', 'Something else'],
];
const BARRIER_IDS = BARRIERS.map(([id]) => id);
export const BARRIER_COUNTIES = [...REGION.counties, 'Other or prefer not to say'];
export const BARRIER_REPORTERS = ['', 'For myself or my family', 'As a worker or volunteer who helps people'];


export function validateBarrierReport(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the form fields.' } };
  const v = {};
  if (!BARRIER_COUNTIES.includes(input.county)) errors.county = 'Please choose a county.';
  v.county = input.county;
  const raw = input.barriers;
  if (!Array.isArray(raw) || !raw.length) errors.barriers = 'Please tick at least one barrier.';
  else if (raw.length > BARRIER_IDS.length || raw.some((b) => typeof b !== 'string' || !BARRIER_IDS.includes(b))) errors.barriers = 'Please choose from the list.';
  v.barriers = Array.isArray(raw) ? [...new Set(raw)].filter((b) => BARRIER_IDS.includes(b)) : [];
  const reporter = input.reporter ?? '';
  if (!BARRIER_REPORTERS.includes(reporter)) errors.reporter = 'Please choose from the list.';
  v.reporter = reporter;
  // No free text on this form (owner decision, 2026-10-12): any comment sent is
  // ignored and never stored.
  v.comment = '';
  return { value: Object.keys(errors).length ? null : v, errors };
}


// ---------- Site notice (owner only) ----------
// Short plain text shown under the crisis bar on every public page. Rule 1:
// the same checks as public fields, so no client details end up public.
// `today` (YYYY-MM-DD, New York) refuses a last day that has already passed,
// which would save a notice that never shows.
export function validateNotice(input, { today = '' } = {}) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the notice fields.' } };
  const message = cleanText(input.message, 280);
  if (message === null) errors.message = 'Please keep the notice under 280 characters.';
  else if (message.includes('\n')) errors.message = 'Please keep the notice to one line.';
  else if (message && CLIENT_INFO.some((c) => c.re.test(message))) errors.message = 'Please don\'t include personal details about clients.';
  const level = input.level ?? 'info';
  if (!['info', 'urgent'].includes(level)) errors.level = 'Please choose from the list.';
  const endsOn = input.ends_on ?? '';
  if (typeof endsOn !== 'string' || (endsOn && !isRealDate(endsOn))) errors.ends_on = 'Please use a date like 2026-12-31.';
  else if (endsOn && today && endsOn < today && message) errors.ends_on = 'That last day has already passed, so the notice would never show. Pick today or a later date, or leave it blank.';
  const value = { message: message ?? '', level, ends_on: endsOn };
  return { value: Object.keys(errors).length ? null : value, errors };
}

