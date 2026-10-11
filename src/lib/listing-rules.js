// Shared rules for listing data: field lists, managed values, formatting and
// checks. Used by the import scripts now and by the Worker's tests later.
// Holds no listing data.

import { REGION } from '../region.js';
import { INTERNAL_TERMS } from '../local/internal-terms.js';

export const COUNTIES = [...REGION.counties, 'Regional'];
export const AGE_GROUPS = ['Children', 'Youth 16–24', 'Adults', 'Seniors'];
export const COSTS = ['Free', 'Sliding scale', 'Insurance', 'Uninsured OK', 'Private pay'];
export const STATUSES = ['Active', 'Temporarily closed', 'Seasonal'];
export const VISIBILITIES = ['Public', 'Internal'];

// Fields that may be shown publicly. Everything else stays admin-only.
export const PUBLIC_FIELDS = [
  'id', 'name', 'organization', 'category', 'tags', 'phone', 'fax', 'email', 'website',
  'address', 'town', 'serves_counties', 'hours', 'eligibility', 'age_groups', 'cost',
  'medicaid_plans', 'medicaid_notes', 'description', 'status', 'review_by', 'last_verified',
  'last_checked_online',
];
export const PRIVATE_FIELDS = ['private_notes', 'visibility', 'retired'];
export const ALL_FIELDS = [...PUBLIC_FIELDS, ...PRIVATE_FIELDS];

const TOWN_COUNTY = REGION.townCounty;
export const KNOWN_TOWNS = Object.keys(TOWN_COUNTY);
const OUT_OF_AREA_TOWNS = REGION.outOfAreaTowns;

export function countyForTown(town) {
  return TOWN_COUNTY[town] ?? null;
}

// Finds the town in a free-text address. Longest names first so
// "South Glens Falls" wins over "Glens Falls".
export function findTown(address) {
  if (!address) return '';
  const all = [...KNOWN_TOWNS, ...OUT_OF_AREA_TOWNS].sort((a, b) => b.length - a.length);
  for (const t of all) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(address)) return t;
  }
  return '';
}

export function isOutOfArea(town) {
  return OUT_OF_AREA_TOWNS.includes(town);
}

// "(518) 555-1234", "(518) 555-1234 x12", "(855) 222-8350". Returns null when
// the input can't be read as a US number. Short codes like 211 pass through.
export function formatPhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^(211|311|511|911|988)$/.test(s)) return s;
  const ext = s.match(/(?:x|ext\.?|extension)\s*(\d{1,6})\s*$/i);
  const main = ext ? s.slice(0, ext.index) : s;
  let digits = main.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  const out = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return ext ? `${out} x${ext[1]}` : out;
}

export const PHONE_PATTERN = /^(\(\d{3}\) \d{3}-\d{4}( x\d{1,6})?|211|311|511|911|988)$/;

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function splitList(raw) {
  return String(raw || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Text that should never appear in a public field: emails or phone numbers
// next to a person's name, "direct line", call scripts, internal tips.
export const PRIVATE_TEXT_PATTERNS = [
  { name: 'direct line', re: /\bdirect (line|contact|email)\b/i },
  { name: 'cell number', re: /\bcell\b\s*:?\s*\(?\d{3}/i },
  { name: 'ask for a named person', re: /\b[Aa]sk for [A-Z][a-z]+\b/ },
  { name: 'contact is a named person', re: /\bcontact (is|:)\s*[A-Z][a-z]+\b/i },
  { name: 'say you are from', re: /\bsay you are from\b/i },
  ...INTERNAL_TERMS.map((re) => ({ name: 'internal reference', re })),
  { name: 'call script placeholder', re: /\[(your|veteran'?s)[^\]]*\]|\[X+(\/X+)*\]/i },
  { name: 'social security reference', re: /\blast four of (his|her|their) social\b/i },
  { name: 'date of birth', re: /\b(DOB|date of birth)\b/i },
  { name: 'SSN-shaped number', re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

export function privateTextHits(text) {
  if (!text) return [];
  return PRIVATE_TEXT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
