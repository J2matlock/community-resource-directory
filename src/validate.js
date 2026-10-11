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

// Rule 1: things that are real client details, not templates.
const CLIENT_INFO = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/, what: 'a Social Security number' },
  { re: /\b(DOB|D\.O\.B\.?|date of birth)\s*[:\-]?\s*\d/i, what: 'a date of birth' },
  { re: /\b(MRN|medical record (no|number|#))\s*[:#]?\s*\d/i, what: 'a medical record number' },
  { re: /\b[A-Z]{2}\d{5}[A-Z]\b/, what: 'a Medicaid ID number' },
];

const DV_PATTERN = /domestic violence|\bDV\b|intimate partner|relationship abuse/i;
// Wording that gives where a shelter or safe house is.
const SHELTER_LOCATION = /\b(shelter|safe ?house|safehouse)\b[^.\n]{0,40}(\b(located|location|address|is at|is on|on [A-Z0-9]|at \d)|\b\d{1,5}\s+[A-Z])/i;
const STREET_ADDRESS = /\b\d{1,5}\s+([A-Z][a-z]+\s+){1,3}(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Pl|Place|Ct|Court|Hwy|Route|Rte)\b/;

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

  if (!v.name) errors.name = 'Name is required.';

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

  for (const f of ['review_by', 'last_verified']) {
    const s = input[f] ?? '';
    if (s !== '' && (typeof s !== 'string' || !DATE.test(s) || Number.isNaN(Date.parse(s)))) {
      errors[f] = 'Use a date like 2027-01-31.';
      v[f] = '';
    } else {
      v[f] = s;
    }
  }

  // Rule 1: no client information anywhere, including private notes.
  for (const f of [...Object.keys(TEXT_LIMITS), 'tags']) {
    const text = Array.isArray(v[f]) ? v[f].join(' ') : v[f];
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
      if (SHELTER_LOCATION.test(v[f]) || STREET_ADDRESS.test(v[f])) {
        errors[f] = 'On a domestic violence program, put the office address only in the address box. Never store a shelter\'s location, in any field, even private notes.';
      }
    }
  }

  // Private-looking text in public fields: warn, unless the listing is Internal.
  if (v.visibility === 'Public') {
    for (const f of PUBLIC_TEXT) {
      for (const hit of privateTextHits(v[f])) {
        warnings.push(`${f.replace('_', ' ')} mentions ${hit}. Private details belong in private notes.`);
      }
    }
  }

  return { value: Object.keys(errors).length ? null : v, errors, warnings };
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

const REQUEST_TEXT = {
  organization: [200, true], services: [3000, true], correction: [3000, false], eligibility: [1000, false], medicaid: [500, false],
  address: [300, false], hours: [500, false], phone: [40, false], email: [200, false], website: [500, false],
  how_to_start: [1000, false], submitter_name: [200, true], submitter_contact: [200, true],
};

export function validateProviderRequest(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the form fields.' } };
  const v = {};
  // "new" asks to add a program; "correction" asks to fix an existing listing.
  if (input.request_type !== undefined && input.request_type !== 'new' && input.request_type !== 'correction') {
    errors.request_type = 'Please choose from the list.';
  }
  v.request_type = input.request_type === 'correction' ? 'correction' : 'new';
  const isCorrection = v.request_type === 'correction';
  for (const [field, [max, required]] of Object.entries(REQUEST_TEXT)) {
    const s = cleanText(input[field], max);
    const needed = isCorrection ? ['organization', 'correction', 'submitter_name', 'submitter_contact'].includes(field) : required;
    if (s === null) errors[field] = `Please keep this under ${max} characters.`;
    else if (needed && !s) errors[field] = 'Please fill this in.';
    v[field] = s ?? '';
  }
  for (const [field, allowed] of [['age_groups', AGE_GROUPS], ['cost', COSTS], ['counties', COUNTIES]]) {
    const raw = input[field] ?? [];
    if (!Array.isArray(raw) || raw.length > allowed.length || raw.some((x) => typeof x !== 'string' || !allowed.includes(x))) {
      errors[field] = 'Please choose from the list.';
      v[field] = [];
    } else {
      v[field] = [...new Set(raw)];
    }
  }
  v.no_public_address = input.no_public_address === true;
  if (v.no_public_address) v.address = '';
  if (input.ok_to_publish !== true && !isCorrection) errors.ok_to_publish = 'Please tick the box to confirm the program details can be published.';
  v.ok_to_publish = input.ok_to_publish === true;

  if (v.phone && !errors.phone) {
    const p = formatPhone(v.phone);
    if (p === null) errors.phone = 'Please use a 10-digit phone number, like (518) 555-1234.';
    else v.phone = p;
  }
  if (v.email && !errors.email && !EMAIL_PATTERN.test(v.email)) errors.email = 'Please check the email address.';
  if (v.website && !errors.website) {
    const w = normalizeWebsite(v.website);
    if (w === null) errors.website = 'Please check the web address.';
    else v.website = w;
  }
  if (!isCorrection && !v.phone && !v.email && !v.website) errors.phone = 'Please give at least a phone, email or website for the program.';

  // Rule 2: a domestic violence program may give an office address only.
  const dvText = [v.organization, v.services, v.eligibility, v.correction].join(' ');
  // A correction can name a DV program without saying so; never accept a shelter location in one.
  if (isCorrection && SHELTER_LOCATION.test(v.correction)) {
    errors.correction = 'Please don\'t include a shelter location. Office addresses only.';
  }
  if (DV_PATTERN.test(dvText)) {
    if (v.address && input.office_not_shelter !== true) {
      errors.address = 'For domestic violence programs, give an office address only, never a shelter location. Tick the box to confirm, or leave the address blank.';
    }
    for (const f of Object.keys(REQUEST_TEXT)) {
      if (f === 'address' || errors[f]) continue;
      if (SHELTER_LOCATION.test(v[f]) || STREET_ADDRESS.test(v[f])) {
        errors[f] = 'Please don\'t include a shelter location or street address here. Put an office address only in the address box.';
      }
    }
  }

  // Rule 1: client information has no place in a provider request.
  for (const f of Object.keys(REQUEST_TEXT)) {
    if (CLIENT_INFO.some((c) => c.re.test(v[f]))) errors[f] = 'Please don\'t include personal details about clients.';
  }
  return { value: Object.keys(errors).length ? null : v, errors };
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

// Rule 1: no client information. Comments are short and only the owner sees
// them; anything that looks like a name with a date, an ID number, an email
// address or a phone number is refused so no one can be identified.
const CONTACT_INFO = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, // email address
  /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // phone number
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/, // any date written in numbers
  /\b(born|birthday|d\.?o\.?b)\b/i, // birth details
  /\bage[sd]?\s*\d{1,3}\b|\b\d{1,3}[\s-]*(years?|yrs?)[\s-]*old\b/i, // an age
  /\b(my|our|a|the)\s+(client|patient|consumer|resident)s?\b/i, // talking about a specific person served
  /\b(?:[Mm]rs?|[Mm]s|[Mm]iss|[Dd]r)\.?\s+[A-Z]/, // a titled name
];

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
  const comment = cleanText(input.comment, 1000);
  if (comment === null) errors.comment = 'Please keep this under 1,000 characters.';
  v.comment = comment ?? '';
  if (v.comment && (CLIENT_INFO.some((c) => c.re.test(v.comment)) || CONTACT_INFO.some((re) => re.test(v.comment)))) {
    errors.comment = 'Please leave out names, dates of birth, ID numbers, phone numbers and email addresses. This form is anonymous.';
  }
  return { value: Object.keys(errors).length ? null : v, errors };
}

// ---------- "Don't see the help you need?" (anonymous, owner-only) ----------
export const SUGGESTION_COUNTIES = ['', ...REGION.counties, 'Somewhere else'];

export function validateSuggestion(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the form fields.' } };
  const v = {};
  const looking = cleanText(input.looking_for, 500);
  if (looking === null) errors.looking_for = 'Please keep this under 500 characters.';
  else if (looking.length < 3) errors.looking_for = 'Please tell us what kind of help you were looking for.';
  else if (CLIENT_INFO.some((c) => c.re.test(looking)) || CONTACT_INFO.some((re) => re.test(looking))) {
    errors.looking_for = 'Please leave out names, ages, birth dates, ID numbers, phone numbers and email addresses. This form is anonymous.';
  }
  v.looking_for = looking ?? '';
  const county = input.county ?? '';
  if (!SUGGESTION_COUNTIES.includes(county)) errors.county = 'Please choose from the list.';
  v.county = county;
  return { value: Object.keys(errors).length ? null : v, errors };
}

// ---------- Site notice (owner only) ----------
// Short plain text shown under the crisis bar on every public page. Rule 1:
// the same checks as public fields, so no client details end up public.
export function validateNotice(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, errors: { _form: 'Expected the notice fields.' } };
  const message = cleanText(input.message, 280);
  if (message === null) errors.message = 'Please keep the notice under 280 characters.';
  else if (message.includes('\n')) errors.message = 'Please keep the notice to one line.';
  else if (message && CLIENT_INFO.some((c) => c.re.test(message))) errors.message = 'Please don\'t include personal details about clients.';
  const level = input.level ?? 'info';
  if (!['info', 'urgent'].includes(level)) errors.level = 'Please choose from the list.';
  const endsOn = input.ends_on ?? '';
  if (typeof endsOn !== 'string' || (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))) errors.ends_on = 'Please use a date like 2026-12-31.';
  const value = { message: message ?? '', level, ends_on: endsOn };
  return { value: Object.keys(errors).length ? null : value, errors };
}

