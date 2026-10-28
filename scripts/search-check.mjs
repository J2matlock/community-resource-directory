// Real-life search check: about 110 phrases people actually type, each with the
// categories its first results should come from (the first result, and at
// least 2 of the top 3), and for some the kind of listing that must come
// first (a free clinic for "free dentist", the hotline for "child abuse").
// Run it after changing search or public/content/words.json.
//   node scripts/search-check.mjs                       (local site, npm run dev)
//   node scripts/search-check.mjs --base https://southernadkhelp.org
// Reads only the public listings; nothing is stored.

import { readFileSync } from 'node:fs';
import '../public/js/search.js';

const base = (process.argv.find((a, i) => process.argv[i - 1] === '--base') || 'http://localhost:8787').replace(/\/$/, '');
const data = await (await fetch(`${base}/api/listings`)).json();
const dict = JSON.parse(readFileSync('public/content/words.json', 'utf8'));
const engine = globalThis.SADKSearch.create(data.listings, dict, { towns: data.towns, counties: data.counties });

// [phrase, categories the top 3 results should come from, optional category the
// first result must be, optional check every one of the top 3 must pass]
const LOW_COST = (l) => l.cost.some((c) => ['Free', 'Sliding scale', 'Uninsured OK'].includes(c));
const inTown = (town) => (l) => l.town === town;
const nameHas = (re) => (l) => re.test(l.name);
const local = (l) => !l.town || Boolean(data.towns?.[l.town]);
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
  // A veteran in crisis: the crisis line first, then crisis or veteran help.
  ['veteran suicide', ['Crisis Help', 'Veterans'], 'Crisis Help'],
  ['suicidal veteran', ['Crisis Help', 'Veterans'], 'Crisis Help'],
  ['veteran crisis', ['Crisis Help', 'Veterans'], 'Crisis Help'],
  ['just got out of prison', ['Legal Help', 'Employment', 'Housing and Shelter']],
  ['comida', ['Food']],
  ['dentista', ['Dental']],
  ['abogado', ['Legal Help']],
  ['nursing home', ['Senior Living and Nursing Homes']],
  ['senior housing', ['Affordable and Senior Apartments', 'Senior Living and Nursing Homes']],
  ['section 8', ['Affordable and Senior Apartments', 'Housing and Shelter']],
  ['low income apartment', ['Affordable and Senior Apartments', 'Housing and Shelter']],
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
  // Places and cost words are wishes: the right kind of help, nearby or free first.
  ['free dentist', ['Dental'], null, LOW_COST],
  ['no insurance dentist', ['Dental'], null, LOW_COST],
  ['dentist sliding scale', ['Dental'], null, LOW_COST],
  ['free lawyer', ['Legal Help'], null, LOW_COST],
  ['food pantry hudson falls', ['Food'], null, (l) => data.towns?.[l.town] === 'Washington'],
  ['food pantry granville', ['Food'], null, (l) => data.towns?.[l.town] === 'Washington'],
  ['free food glens falls', ['Food'], null, inTown('Glens Falls')],
  ['glens falls hospital', ['Hospitals', 'Urgent Care'], 'Hospitals'],
  ['hospital', ['Hospitals', 'Urgent Care'], 'Hospitals', local],
  ['emergency room', ['Hospitals', 'Urgent Care'], 'Hospitals', local],
  ['lawyer', ['Legal Help'], null, local],
  ['warming center', ['Housing and Shelter', 'Rent, Utility and Emergency Help'], null, (l, i) => i > 0 || local(l)],
  // Abuse of a child or an older adult: the hotline and APS, not DV programs.
  ['child abuse', ['Crisis Help', 'Pregnancy and Young Children'], 'Crisis Help'],
  ['report child abuse', ['Crisis Help', 'Pregnancy and Young Children'], 'Crisis Help'],
  ['elder abuse', ['Social Services'], null, nameHas(/Protective Services/)],
  ['adult protective services', ['Social Services'], null, nameHas(/Protective Services/)],
  // Small typos in everyday words.
  ['food stampes', ['Social Services', 'Food'], 'Social Services'],
  ['food stamp', ['Social Services', 'Food'], 'Social Services'],
  ['methadon', ['Substance Use and Recovery']],
  ['depresion', ['Mental Health', 'Crisis Help']],
  ['medicade', ['Social Services', 'Navigation and Advocacy']],
  ['foodbank', ['Food']],
  // Generic words don't drown out the need.
  ['snap benefits', ['Social Services', 'Food'], 'Social Services'],
  ['apply for snap', ['Social Services', 'Food'], 'Social Services'],
  ['medicaid card', ['Social Services', 'Navigation and Advocacy']],
  ['child support', ['Social Services']],
  ['security deposit', ['Rent, Utility and Emergency Help', 'Housing and Shelter']],
  ['car seat', ['Pregnancy and Young Children']],
  ['home modifications', ['Home Repair']],
  // General help before specialists unless the specialty is asked for.
  ['dentist', ['Dental'], null, (l) => !/orthodont|oral &|maxillofacial|pediatric dent/i.test(l.name)],
  ['orthodontist', ['Dental'], null, nameHas(/Orthodont/)],
  // Real words are never "corrected" into other help, and long messages keep
  // the safety handling.
  ['took too many pills', ['Substance Use and Recovery', 'Crisis Help']],
  ['he keeps hitting me', ['Domestic Violence']],
  ['i need help please my boyfriend and i have been fighting a lot and he hits me', ['Domestic Violence']],
  ['hi i am looking for some help for me and my kids because my husband beat me', ['Domestic Violence']],
  ['sexual exploitation', ['Domestic Violence', 'Crisis Help']],
  ['glass', ['Eye Care', 'Ophthalmology']],
  ['overdue rent', ['Rent, Utility and Emergency Help', 'Housing and Shelter']],
  ['custody mediation', ['Legal Help']],
  ['uninsured', ['Medical', 'Urgent Care'], null, LOW_COST],
  // Self-harm wording reaches crisis help (988 note).
  ['killing myself', ['Crisis Help', 'Mental Health'], 'Crisis Help'],
  ['im cutting myself', ['Crisis Help', 'Mental Health'], 'Crisis Help'],
  ['hurting myself', ['Crisis Help', 'Mental Health'], 'Crisis Help'],
  ['me pega mi esposo', ['Domestic Violence']],
];

let pass = 0;
const fails = [];
for (const [phrase, cats, firstCat, each] of CASES) {
  const r = engine.search(phrase);
  const top = r.results.slice(0, 3);
  // The first result must be the right kind of help, and most of the top 3.
  const ok = top.length > 0 && (firstCat ? top[0].category === firstCat : cats.includes(top[0].category)) && top.filter((l) => cats.includes(l.category)).length >= Math.min(2, top.length)
    && (!each || top.every(each));
  if (ok) pass++;
  else fails.push(`  ✗ "${phrase}" (${r.mode}): ${top.map((l) => `${l.name} [${l.category}]`).join(' | ') || 'no results'}`);
}
console.log(`Search check: ${pass} of ${CASES.length} phrases put the right kind of help first.`);
if (fails.length) console.log(fails.join('\n'));
process.exit(fails.length ? 1 : 0);
