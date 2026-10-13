// Real-life search check: about 55 phrases people actually type, each with the
// categories its first results should come from (the first result, and at
// least 2 of the top 3). Run it after changing search
// or public/content/words.json.
//   node scripts/search-check.mjs                       (local site, npm run dev)
//   node scripts/search-check.mjs --base https://southernadkhelp.org
// Reads only the public listings; nothing is stored.

import { readFileSync } from 'node:fs';
import '../public/js/search.js';

const base = (process.argv.find((a, i) => process.argv[i - 1] === '--base') || 'http://localhost:8787').replace(/\/$/, '');
const data = await (await fetch(`${base}/api/listings`)).json();
const dict = JSON.parse(readFileSync('public/content/words.json', 'utf8'));
const engine = globalThis.SADKSearch.create(data.listings, dict);

// [phrase, categories the top 3 results should come from]
const CASES = [
  ['help paying rent', ['Rent, Utility and Emergency Help', 'Housing and Shelter']],
  ['I need help paying my electric bill', ['Rent, Utility and Emergency Help']],
  ['lights shut off', ['Rent, Utility and Emergency Help']],
  ['heating oil', ['Rent, Utility and Emergency Help', 'Home Repair']],
  ['no heat', ['Rent, Utility and Emergency Help', 'Home Repair']],
  ['welfare', ['Social Services']],
  ['food stamps', ['Social Services', 'Food']],
  ['I need food', ['Food']],
  ['food pantry granville', ['Food']],
  ['hungry', ['Food']],
  ['OFA', ['Senior Centers and Social', 'Social Services']],
  ['meals on wheels', ['Senior Centers and Social', 'Food']],
  ['ride to doctor', ['Transportation']],
  ['medicaid ride', ['Transportation']],
  ['walker', ['Disability Services', 'Senior Centers and Social', 'Home Care']],
  ['birth certificate', ['IDs and Documents']],
  ['drinking', ['Substance Use and Recovery', 'Crisis Help']],
  ['narcan', ['Substance Use and Recovery', 'Crisis Help']],
  ['AA meeting', ['Substance Use and Recovery', 'Crisis Help']],
  ['depressed', ['Mental Health', 'Crisis Help']],
  ['suicidal', ['Crisis Help', 'Mental Health']],
  ['beat me', ['Domestic Violence']],
  ['my boyfriend hits me', ['Domestic Violence']],
  ['not safe at home', ['Domestic Violence']],
  ['order of protection', ['Domestic Violence', 'Legal Help']],
  ['kicked out', ['Housing and Shelter', 'Rent, Utility and Emergency Help']],
  ['nowhere to sleep tonight', ['Housing and Shelter', 'Rent, Utility and Emergency Help']],
  ['homeless shelter', ['Housing and Shelter', 'Rent, Utility and Emergency Help']],
  ['eviction', ['Housing and Shelter', 'Rent, Utility and Emergency Help', 'Legal Help']],
  ['dentist', ['Dental']],
  ['dentist medicaid', ['Dental']],
  ['dentst', ['Dental']],
  ['toothache', ['Dental']],
  ['glasses', ['Eye Care', 'Ophthalmology']],
  ['lawyer', ['Legal Help']],
  ['custody', ['Legal Help']],
  ['job', ['Employment']],
  ['ged', ['Adult Education and GED']],
  ['wifi', ['Libraries and Computers']],
  ['diapers', ['Pregnancy and Young Children']],
  ['pregnant', ['Pregnancy and Young Children']],
  ['daycare', ['Child Care', 'Youth Programs']],
  ['lonely', ['Senior Centers and Social', 'Mental Health']],
  ['veteran', ['Veterans']],
  ['just got out of prison', ['Legal Help', 'Employment', 'Housing and Shelter']],
  ['comida', ['Food']],
  ['dentista', ['Dental']],
  ['abogado', ['Legal Help']],
  ['nursing home', ['Senior Living and Nursing Homes']],
  ['home care aide', ['Home Care', 'Hospice and Caregiver Support']],
  ['hospice', ['Hospice and Caregiver Support']],
  ['furniture', ['Furniture and Appliances']],
  ['winter coat', ['Clothing']],
  ['pet food', ['Pet Help']],
  ['urgent care', ['Urgent Care']],
  ['needle exchange', ['Substance Use and Recovery', 'Medical']],
  ['test strips', ['Substance Use and Recovery', 'Medical']],
  ['methadone clinic', ['Substance Use and Recovery']],
  ['bad trip', ['Substance Use and Recovery', 'Crisis Help']],
  ['using alone', ['Substance Use and Recovery', 'Crisis Help']],
  ['spend down', ['Disability Services', 'Legal Help']],
  ['pooled trust', ['Disability Services', 'Legal Help']],
];

let pass = 0;
const fails = [];
for (const [phrase, cats] of CASES) {
  const r = engine.search(phrase);
  const top = r.results.slice(0, 3);
  // The first result must be the right kind of help, and most of the top 3.
  const ok = top.length > 0 && cats.includes(top[0].category) && top.filter((l) => cats.includes(l.category)).length >= Math.min(2, top.length);
  if (ok) pass++;
  else fails.push(`  ✗ "${phrase}" (${r.mode}): ${top.map((l) => `${l.name} [${l.category}]`).join(' | ') || 'no results'}`);
}
console.log(`Search check: ${pass} of ${CASES.length} phrases put the right kind of help first.`);
if (fails.length) console.log(fails.join('\n'));
process.exit(fails.length ? 1 : 0);
