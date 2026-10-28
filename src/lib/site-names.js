// Category and plan names that the site's own code and content depend on.
// Renaming one in the admin panel would quietly switch off what uses it (the
// domestic violence protections, search words, the 3-month re-check), so the
// admin panel locks these names. To rename one, change it everywhere at once
// with Claude: the copies listed below, public/content/words.json, and the
// Learn page text.

import { FAST_RECHECK_CATEGORIES } from '../db/admin.js';

export const DV_CATEGORY = 'Domestic Violence';

// Names written into code. Front-end copies: public/js/directory.js (DV,
// CARE_COMPARE, the "Or try a category" list, UNSPECIFIED_PLAN),
// and public/js/search.js (DV).
export const CODE_CATEGORIES = [
  DV_CATEGORY,
  ...FAST_RECHECK_CATEGORIES,
  'Home Care', 'Senior Living and Nursing Homes', 'Hospice and Caregiver Support',
  'Food', 'Rent, Utility and Emergency Help', 'Housing and Shelter', 'Medical',
];
export const CODE_PLANS = ['Medicaid (call to check plan)'];

// Category names used by the everyday-words list (exact names) and named in
// Learn answers ("… the Crisis Help category of this directory").
async function contentText(env, path) {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

/** Names of `kind` ('categories' or 'plans') that can't be renamed here. */
export async function lockedNames(env, kind) {
  if (kind === 'plans') return new Set(CODE_PLANS);
  const names = new Set(CODE_CATEGORIES);
  const words = await contentText(env, '/content/words.json');
  try {
    for (const e of JSON.parse(words || '{}').entries || []) for (const c of e.categories || []) names.add(c);
  } catch { /* unreadable list: code names still locked */ }
  const learn = await contentText(env, '/content/learn.json');
  for (const m of learn.matchAll(/the ([A-Z][A-Za-z,' ]+?) category\b/g)) names.add(m[1]);
  return names;
}
