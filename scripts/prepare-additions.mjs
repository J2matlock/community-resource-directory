// Turn a research additions file into new listings, after launch.
//   node scripts/prepare-additions.mjs data/import/<additions file>.mjs
// Same clean-up and checks as an admin-panel save. Writes <file>.json next to
// it (under data/, git-ignored). Load it with scripts/add-live.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { validateListing } from '../src/validate.js';
import { todayLocal } from '../src/db/admin.js';
import {
  countyForTown, findTown, isOutOfArea, formatPhone, slugify, splitList, privateTextHits, PUBLIC_FIELDS,
} from '../src/lib/listing-rules.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/prepare-additions.mjs data/import/<file>.mjs'); process.exit(1); }
const A = await import(pathToFileURL(resolve(file)).href);
const base = JSON.parse(readFileSync('data/import/listings.json', 'utf8'));
const categories = [...new Set([...base.categories, ...(A.NEW_CATEGORIES ?? [])])];
const plans = base.medicaid_plans;
const used = new Set(base.listings.map((l) => l.id));
const today = todayLocal();

const problems = [];
const listings = A.ADDITIONS.map((a) => {
  const address = a.address ?? '';
  const town = a.town ?? findTown(address);
  const counties = a.serves_counties ?? (countyForTown(town) ? [countyForTown(town)] : []);
  let description = a.description ?? '';
  if (address && isOutOfArea(town)) description = `Outside Warren, Washington and Saratoga Counties: the office is in ${town}. ${description}`;
  const input = {
    name: a.name, organization: a.organization ?? '', category: a.category,
    tags: [...new Set(splitList(a.tags).map((t) => t.toLowerCase()))],
    phone: a.phone ? formatPhone(a.phone) ?? a.phone : '', fax: a.fax ? formatPhone(a.fax) ?? a.fax : '',
    email: (a.email ?? '').toLowerCase(), website: a.website ?? '', address, town, serves_counties: counties,
    hours: a.hours ?? '', eligibility: a.eligibility ?? '', age_groups: a.ages ?? a.age_groups ?? [], cost: a.cost ?? [],
    medicaid_plans: a.medicaid_plans ?? [], medicaid_notes: a.medicaid_notes ?? '', description,
    sources: a.sources ?? [],
    private_notes: `Added by research on ${today} (not on the original spreadsheet). Found on: ${a.src}. Not yet confirmed by phone.`,
    status: a.status ?? 'Active', review_by: a.review_by ?? '', visibility: 'Public', last_verified: '', last_checked_online: today,
  };
  // confirm_office: the researcher confirmed the address is an office (rule 2), as the admin box does.
  const { value, errors, warnings } = validateListing({ ...input, confirm_office_address: a.confirm_office === true }, { categories, plans });
  for (const [f, m] of Object.entries(errors)) problems.push(`${a.name}: ${f}: ${m}`);
  for (const w of warnings) problems.push(`${a.name}: ${w}`);
  for (const f of PUBLIC_FIELDS) {
    const t = Array.isArray(input[f]) ? input[f].join(' ') : String(input[f] ?? '');
    for (const hit of privateTextHits(t)) problems.push(`${a.name}: public field ${f} contains ${hit}`);
  }
  let id = slugify(a.name);
  for (let k = 2; used.has(id); k++) id = `${slugify(a.name)}-${k}`;
  used.add(id);
  return { ...(value ?? input), id, retired: false, ...(a.confirm_office === true ? { confirm_office_address: true } : {}) };
});

if (problems.length) {
  console.error(`NOT READY: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const out = file.replace(/\.mjs$/, '.json');
writeFileSync(out, JSON.stringify({ new_categories: A.NEW_CATEGORIES ?? [], listings }, null, 2) + '\n');
console.log(`Ready: ${listings.length} new listings, ${(A.NEW_CATEGORIES ?? []).length} new categories -> ${out}`);
