// Public queries (rule 4). These select only public columns and exclude
// Internal and retired listings in SQL. Never add private_notes, visibility
// or retired to this file, and never filter private data in the browser.

import { COUNTIES, AGE_GROUPS, COSTS } from '../lib/listing-rules.js';

const PUBLIC_COLUMNS = [
  'id', 'name', 'organization', 'category', 'tags', 'phone', 'fax', 'email', 'website',
  'address', 'town', 'serves_counties', 'hours', 'eligibility', 'age_groups', 'cost',
  'medicaid_plans', 'medicaid_notes', 'description', 'status', 'review_by', 'last_verified',
];

const JSON_COLUMNS = ['tags', 'serves_counties', 'age_groups', 'cost', 'medicaid_plans'];

const PUBLIC_LISTINGS_SQL = `
  SELECT ${PUBLIC_COLUMNS.join(', ')}
  FROM listings
  WHERE visibility = 'Public' AND retired = 0
  ORDER BY name COLLATE NOCASE`;

export async function getPublicDirectory(db) {
  // Only names used by at least one public listing, so a category or plan
  // that exists only for Internal or retired listings stays private too.
  const [listings, categories, plans] = await db.batch([
    db.prepare(PUBLIC_LISTINGS_SQL),
    db.prepare(`SELECT c.name FROM categories c
      WHERE EXISTS (SELECT 1 FROM listings l WHERE l.category = c.name AND l.visibility = 'Public' AND l.retired = 0)
      ORDER BY c.name COLLATE NOCASE`),
    db.prepare(`SELECT p.name FROM medicaid_plans p
      WHERE EXISTS (SELECT 1 FROM listings l, json_each(l.medicaid_plans) j
                    WHERE j.value = p.name AND l.visibility = 'Public' AND l.retired = 0)
      ORDER BY p.name COLLATE NOCASE`),
  ]);
  return {
    listings: listings.results.map(parsePublicRow),
    categories: categories.results.map((r) => r.name),
    medicaid_plans: plans.results.map((r) => r.name),
    counties: COUNTIES,
    age_groups: AGE_GROUPS,
    costs: COSTS,
  };
}

function parsePublicRow(row) {
  const out = {};
  for (const col of PUBLIC_COLUMNS) {
    out[col] = JSON_COLUMNS.includes(col) ? JSON.parse(row[col] || '[]') : row[col] ?? '';
  }
  return out;
}

export { PUBLIC_COLUMNS };

// One public listing by id, for the listing page's title and link preview.
// Same public columns and the same filter as the directory (rule 4).
export async function getPublicListing(db, id) {
  const row = await db.prepare(`SELECT ${PUBLIC_COLUMNS.join(', ')} FROM listings
    WHERE id = ? AND visibility = 'Public' AND retired = 0`).bind(id).first();
  return row ? parsePublicRow(row) : null;
}

// Ids of every public listing, for the sitemap.
export async function getPublicListingIds(db) {
  const { results } = await db.prepare(`SELECT id FROM listings
    WHERE visibility = 'Public' AND retired = 0 ORDER BY id`).all();
  return results.map((r) => r.id);
}

