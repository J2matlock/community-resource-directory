// Directory search (public/js/search.js) with the real everyday-words list.
// The full real-life check against live listings is scripts/search-check.mjs.

import { describe, it, expect } from 'vitest';
import '../public/js/search.js';
import words from '../public/content/words.json';

const L = (id, category, name, extra = {}) => ({
  id, category, name, tags: [], organization: '', town: '', serves_counties: [], medicaid_plans: [],
  description: '', eligibility: '', ...extra,
});
const listings = [
  L('dss', 'Social Services', 'Warren County DSS', { tags: ['dss'] }),
  L('pantry', 'Food', 'Hometown Food Pantry', { town: 'Granville', description: 'Free groceries.' }),
  L('rent', 'Rent, Utility and Emergency Help', 'Emergency Fund', { description: 'Help with back rent and utility bills.' }),
  L('dv', 'Domestic Violence', 'Safe Home Hotline', { description: 'Help if you are not safe at home.' }),
  L('ride', 'Transportation', 'Medicaid Rides', { description: 'Rides to medical appointments.' }),
  L('clinic', 'Medical', 'Family Doctor Office', { description: 'Primary care doctor.' }),
  L('dentist', 'Dental', 'Smile Dentist', { medicaid_plans: ['Straight Medicaid (fee-for-service)'] }),
  L('office', 'Senior Centers and Social', 'Senior Office', { description: 'Office hours for seniors.' }),
];
const engine = globalThis.SADKSearch.create(listings, words);
const top = (q) => engine.search(q).results.map((l) => l.id);

describe('Search', () => {
  it('understands everyday words and drops filler words', () => {
    expect(top('I need help paying my rent')[0]).toBe('rent');
    expect(top('welfare')[0]).toBe('dss');
    expect(top('I need food')[0]).toBe('pantry');
  });

  it('lets the longest phrase win ("ride to doctor" is a ride)', () => {
    expect(top('ride to doctor')[0]).toBe('ride');
  });

  it('puts domestic violence help first and flags the search as sensitive', () => {
    const r = engine.search('he beat me');
    expect(r.results[0].id).toBe('dv');
    expect(r.safety).toBe(true);
  });

  it('matches dictionary words as whole words only ("off" is not "office")', () => {
    expect(top('lights shut off')).not.toContain('office');
  });

  it('shows a plain explainer for local names', () => {
    expect(engine.search('OFA').notes[0]).toMatch(/Office for the Aging/);
  });

  it('allows small typos only when nothing matches, and says it is unsure', () => {
    const r = engine.search('dentst');
    expect(r.mode).toBe('unsure');
    expect(r.results[0].id).toBe('dentist');
  });

  it('returns nothing (not random guesses) for unknown words', () => {
    expect(engine.search('xyzzy').results).toHaveLength(0);
  });

  it('every dictionary entry names only real-looking categories and has words to match', () => {
    for (const e of words.entries) {
      expect(e.match.length).toBeGreaterThan(0);
      for (const c of e.categories) expect(typeof c).toBe('string');
    }
  });
});
