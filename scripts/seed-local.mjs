// Fill the LOCAL database (your computer only) with listings.
//   node scripts/seed-local.mjs            made-up practice listings
//   node scripts/seed-local.mjs --real     the approved import (data/import/listings.json)
//   node scripts/seed-local.mjs --draft    the unapproved draft, to preview it locally
// Never touches the live database. The live import is a separate, owner-approved step.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SAMPLE_CATEGORIES, SAMPLE_PLANS, SAMPLE_LISTINGS } from '../test/fixtures/sample-listings.js';

const real = process.argv.includes('--real');
const draft = process.argv.includes('--draft');
let categories, plans, listings;

if (draft) {
  listings = JSON.parse(readFileSync('data/import/draft-listings.json', 'utf8'));
  categories = [...new Set(listings.map((l) => l.category))];
  const P = await import(new URL('../data/import/proposals.mjs', import.meta.url));
  plans = P.MEDICAID_PLANS;
} else if (real) {
  const path = 'data/import/listings.json';
  if (!existsSync(path)) {
    console.error(`${path} doesn't exist yet. It is made after the owner approves the cleanup report.`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  ({ categories, medicaid_plans: plans, listings } = data);
} else {
  categories = SAMPLE_CATEGORIES;
  plans = SAMPLE_PLANS;
  listings = SAMPLE_LISTINGS;
}

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const JSON_COLS = ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans'];
const COLS = ['id', 'name', 'organization', 'category', ...JSON_COLS, 'phone', 'fax', 'email', 'website', 'address', 'town',
  'hours', 'eligibility', 'medicaid_notes', 'description', 'private_notes', 'status', 'review_by', 'visibility', 'last_verified', 'retired'];

const sql = [
  'DELETE FROM listing_history;', 'DELETE FROM provider_requests;', 'DELETE FROM listings;',
  'DELETE FROM categories;', 'DELETE FROM medicaid_plans;',
  ...categories.map((c) => `INSERT INTO categories (name) VALUES (${q(c)});`),
  ...plans.map((p) => `INSERT INTO medicaid_plans (name) VALUES (${q(p)});`),
  ...listings.map((l) => `INSERT INTO listings (${COLS.join(', ')}) VALUES (${COLS.map((c) =>
    JSON_COLS.includes(c) ? q(JSON.stringify(l[c] ?? [])) : c === 'retired' ? (l.retired ? 1 : 0) : q(l[c])).join(', ')});`),
];

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed.sql', sql.join('\n') + '\n');
const run = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
run(['d1', 'migrations', 'apply', 'DB', '--local']);
run(['d1', 'execute', 'DB', '--local', '--file', '.wrangler/seed.sql']);
const kind = real ? 'listings from the approved import' : draft ? 'DRAFT listings (not approved yet)' : 'practice listings';
console.log(`Local database filled with ${listings.length} ${kind}.`);
