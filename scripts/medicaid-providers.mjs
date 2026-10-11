// List dentists and eye care providers enrolled in Straight (fee-for-service)
// Medicaid in our counties, from New York's open Medicaid Enrolled Provider
// Listing (health.data.ny.gov, dataset keti-qx5t), grouped into one row per
// office address, and marked if the office is already in the directory.
//   node scripts/medicaid-providers.mjs
//   node scripts/medicaid-providers.mjs --counties WARREN,WASHINGTON,SARATOGA,ALBANY,SCHENECTADY,RENSSELAER
//   node scripts/medicaid-providers.mjs --specialty OPHTHALMOLOGY   (any physician specialty in the state data)
// Writes data/medicaid/ffs-dental-eye-<date>.xlsx and .csv (local only).
// Compares against the LOCAL database (refresh it first if needed).
// "Enrolled" means the provider can bill Straight Medicaid; it does not mean
// they are taking new Medicaid patients.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildXlsx } from '../src/xlsx.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const COUNTIES = arg('--counties', 'WARREN,WASHINGTON,SARATOGA').toUpperCase().split(',').map((c) => c.trim()).filter(Boolean);
const SPECIALTY = arg('--specialty', '').toUpperCase().trim();
const TYPES = {
  'DENTISTS': 'Dental', 'DENTAL GROUP PRACTICE': 'Dental',
  'OPTOMETRIST': 'Eye care', 'OPTICAL ESTABLISHMENT': 'Eye care', 'OPTICIAN': 'Eye care',
};
const GROUP_TYPES = new Set(['DENTAL GROUP PRACTICE', 'OPTICAL ESTABLISHMENT']);
const API = 'https://health.data.ny.gov/resource/keti-qx5t.json';

// 1. Fetch every FFS row of these types in these counties (paged).
const sqlList = (xs) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
if (SPECIALTY) { for (const k of Object.keys(TYPES)) delete TYPES[k]; TYPES.PHYSICIAN = SPECIALTY.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
const where = SPECIALTY
  ? `medicaid_type='FFS' AND county in (${sqlList(COUNTIES)}) AND profession_or_service='PHYSICIAN' AND upper(provider_specialty)=${sqlList([SPECIALTY])}`
  : `medicaid_type='FFS' AND county in (${sqlList(COUNTIES)}) AND profession_or_service in (${sqlList(Object.keys(TYPES))})`;
async function fetchAll(whereClause) {
  const out = [];
  for (let offset = 0; ; offset += 5000) {
    const url = `${API}?${new URLSearchParams({ $where: whereClause, $limit: '5000', $offset: String(offset), $order: 'county,city,service_address' })}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) { console.error(`The state data site answered ${res.status}. Try again later.`); process.exit(1); }
    const page = await res.json();
    out.push(...page);
    if (page.length < 5000) return out;
  }
}
const rows = await fetchAll(where);
// Practices and clinics at the same addresses, used to name offices where
// only individual dentists or optometrists are listed.
const ORG_TYPES = ['DENTAL GROUP PRACTICE', 'OPTICAL ESTABLISHMENT', 'MULTI TYPE GROUP PRACTICE', 'PHYSICIAN GROUP PRACTICE', 'OUTPATIENT CLINIC', 'OUTPATIENT', 'HOSPITAL - INPATIENT'];
const orgRows = await fetchAll(`medicaid_type='FFS' AND county in (${sqlList(COUNTIES)}) AND profession_or_service in (${sqlList(ORG_TYPES)})`);
if (!rows.length) { console.error('No providers found. Check the county names.'); process.exit(1); }

// 2. Group by office address.
const title = (s) => String(s ?? '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();
const phone = (p) => { const d = String(p ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''; };
// Same building = same street number and street, in the same ZIP code (or
// town, when there's no ZIP). The state data spells towns inconsistently, e.g.
// one Route 9 plaza appears under both Glens Falls and Queensbury.
const street = (address) => {
  const a = String(address ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^P ?O BOX \d+ /, '');
  const m = a.match(/^(\d+[A-Z]?)\s+(?:(?:N|S|E|W|NORTH|SOUTH|EAST|WEST|US|NY|STATE|ROUTE|RT|RTE|HWY)\s+)*(\w+)/);
  return m ? `${m[1]} ${m[2]}` : a;
};
const addrKey = (address, place) => `${street(address)}|${String(place ?? '').toUpperCase().trim().slice(0, 5)}`;
const officeKey = (r) => addrKey(r.service_address, String(r.zip_code ?? '').slice(0, 5) || r.city);
const offices = new Map();
for (const r of rows) {
  const key = officeKey(r);
  const o = offices.get(key) ?? { kinds: new Set(), groups: new Set(), people: new Set(), phones: new Set(), address: r.service_address, city: r.city, county: r.county, zip: r.zip_code, dentists: 0, eye: 0, since: r.enrollment_begin_date };
  o.kinds.add(TYPES[r.profession_or_service]);
  if (GROUP_TYPES.has(r.profession_or_service)) o.groups.add(title(r.mmis_name));
  else o.people.add(title(r.mmis_name));
  if (r.profession_or_service === 'DENTISTS' || (SPECIALTY && r.profession_or_service === 'PHYSICIAN')) o.dentists++;
  if (r.profession_or_service === 'OPTOMETRIST' || r.profession_or_service === 'OPTICIAN') o.eye++;
  if (phone(r.telephone)) o.phones.add(phone(r.telephone));
  if (r.enrollment_begin_date && r.enrollment_begin_date < o.since) o.since = r.enrollment_begin_date;
  offices.set(key, o);
}

// Name offices that only list individual clinicians, from practices or
// clinics registered at the same address.
const orgNames = new Map();
// Only names that clearly fit: buildings often hold several unrelated practices.
const FITS = /DENT|ORTHOD|ORAL|SMILE|TEETH|OPTI|OPTOM|EYE|VISION|OPHTH|RETIN|CATARACT|HEALTH NETWORK|COMMUNITY HEALTH CENTER/;
for (const r of orgRows) {
  if (!FITS.test(String(r.mmis_name).toUpperCase())) continue;
  const k = officeKey(r);
  if (!orgNames.has(k)) orgNames.set(k, new Set());
  orgNames.get(k).add(title(r.mmis_name));
}
for (const [k, o] of offices) {
  if (!o.groups.size && orgNames.has(k)) for (const n of orgNames.get(k)) o.groups.add(n);
}

// 3. Mark offices already in the directory (local database).
let listings = [];
try {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command',
    "SELECT name, address, town FROM listings WHERE retired = 0"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  listings = JSON.parse(out)[0].results;
} catch { console.warn('Could not read the local database; the "In directory" column will be empty.'); }
const listed = new Map();
for (const l of listings) {
  const m = String(l.address ?? '').match(/(\d+[A-Za-z]?\s+[^,]+),\s*([^,]+),\s*NY\s*(\d{5})?/);
  if (m) {
    listed.set(addrKey(m[1], m[2]), l.name);
    if (m[3]) listed.set(addrKey(m[1], m[3]), l.name);
  } else if (l.address && l.town) listed.set(addrKey(l.address, l.town), l.name);
}
const inDirectory = (o) => listed.get(addrKey(o.address, String(o.zip ?? '').slice(0, 5))) ?? listed.get(addrKey(o.address, o.city)) ?? '';

// 4. Write the spreadsheet and CSV.
const header = ['Type', 'Practice', 'Clinicians enrolled (sample)', 'Address', 'City', 'County', 'ZIP', 'Phone', SPECIALTY ? 'Doctors' : 'Dentists', 'Eye providers', 'Enrolled since', 'In directory as'];
const practiceRows = [...offices.values()]
  .map((o) => [
    [...o.kinds].join(' + '),
    [...o.groups].join('; ') || (o.people.size === 1 ? [...o.people][0] : `${[...o.people][0]} and ${o.people.size - 1} more (no practice name listed)`),
    [...o.people].slice(0, 4).join('; ') + (o.people.size > 4 ? `; +${o.people.size - 4} more` : ''),
    title(o.address), title(o.city), title(o.county), String(o.zip ?? '').slice(0, 5),
    [...o.phones].join(' / '), o.dentists, o.eye, String(o.since ?? '').slice(0, 10),
    inDirectory(o),
  ])
  .sort((a, b) => a[0].localeCompare(b[0]) || a[5].localeCompare(b[5]) || a[4].localeCompare(b[4]));
const rawRows = rows.map((r) => [r.mmis_name, r.profession_or_service, r.provider_specialty ?? '', r.service_address, r.city, r.county, r.zip_code, phone(r.telephone), String(r.enrollment_begin_date ?? '').slice(0, 10), r.npi ?? '']);
const today = new Date().toISOString().slice(0, 10);
const about = [
  [`Straight (fee-for-service) Medicaid: ${SPECIALTY ? title(SPECIALTY) : 'dentists and eye care'}`],
  [`Source: NYS Medicaid Enrolled Provider Listing, health.data.ny.gov (dataset keti-qx5t), downloaded ${today}.`],
  [`Counties: ${COUNTIES.map(title).join(', ')}. ${offices.size} offices, ${rows.length} enrolled providers.`],
  ['Enrolled means the provider can bill Straight Medicaid. It does not mean they are taking new Medicaid patients: call to check.'],
  ['"In directory as" is matched by street number, street and town, so check any near-misses by hand.'],
];
mkdirSync('data/medicaid', { recursive: true });
const base = `data/medicaid/ffs-${SPECIALTY ? SPECIALTY.toLowerCase().replace(/[^a-z]+/g, '-') : 'dental-eye'}-${today}`;
writeFileSync(`${base}.xlsx`, buildXlsx([
  { name: 'Practices', rows: [header, ...practiceRows] },
  { name: 'All providers', rows: [['Name', 'Type', 'Specialty', 'Address', 'City', 'County', 'ZIP', 'Phone', 'Enrolled since', 'NPI'], ...rawRows] },
  { name: 'About', rows: about },
]));
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(`${base}.csv`, [header, ...practiceRows].map((r) => r.map(csv).join(',')).join('\n') + '\n');

const inDir = practiceRows.filter((r) => r[11]).length;
const byType = (t) => practiceRows.filter((r) => r[0].includes(t)).length;
console.log(`${rows.length} enrolled providers at ${offices.size} offices${SPECIALTY ? '' : ` (${byType('Dental')} dental, ${byType('Eye')} eye care)`} in ${COUNTIES.map(title).join(', ')}.`);
console.log(`${inDir} offices already in the directory; ${offices.size - inDir} not yet.`);
console.log(`Saved: ${base}.xlsx and ${base}.csv`);
