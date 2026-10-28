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
  L('recovery', 'Substance Use and Recovery', 'Recovery Center', { description: 'Peer support.' }),
  L('hiv', 'Medical', 'Health Alliance', { tags: ['hiv testing', 'syringe exchange'] }),
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

  it('finds a syringe program filed under another category by its tags', () => {
    const r = top('needle exchange');
    expect(r.indexOf('hiv')).toBeLessThan(r.indexOf('recovery'));
  });

  it('puts domestic violence help first and flags the search as sensitive', () => {
    const r = engine.search('he beat me');
    expect(r.results[0].id).toBe('dv');
    expect(r.safety).toBe(true);
  });

  it('matches dictionary words as whole words only ("off" is not "office")', () => {
    expect(top('lights shut off')).not.toContain('office');
  });

  it('treats singular and plural as the same word, without trimming words like "news"', () => {
    const p = globalThis.SADKSearch.create([
      L('vcl', 'Crisis Help', 'Veterans Crisis Line', { tags: ['veterans', 'suicide'] }),
      L('agency', 'Veterans', 'County Veterans Agency'),
      L('dent', 'Dental', 'Family Dentist'),
      L('glass', 'Eye Care', 'Eye Glass Shop'),
      L('ny', 'Social Services', 'New York Benefits'),
    ], words);
    const first = (q) => p.search(q).results.map((l) => l.id);
    expect(first('suicidal veteran')[0]).toBe('vcl');
    expect(first('dentists')).toContain('dent');
    expect(first('glasses')).toContain('glass');
    expect(p.search('urgent cares').mode).toBe('understood'); // "cares" is "care", not "car"
    expect(p.search('news').mode).toBe('unsure'); // only the typo fallback, never a real match
  });

  it('shows a plain explainer for local names', () => {
    expect(engine.search('OFA').notes[0]).toMatch(/Office for the Aging/);
  });

  it('understands a small typo in an everyday word, and says what it searched for', () => {
    const r = engine.search('dentst');
    expect(r.mode).toBe('understood');
    expect(r.corrected).toBe('dentist');
    expect(r.results[0].id).toBe('dentist');
    expect(engine.search('food stampes').results[0].id).toBe('dss');
  });

  it('allows other small typos only when nothing matches, and says it is unsure', () => {
    const r = engine.search('smilee');
    expect(r.mode).toBe('unsure');
    expect(r.results[0].id).toBe('dentist');
  });

  it('never "corrects" a word a listing actually uses', () => {
    expect(engine.search('hometown').corrected).toBe('');
  });

  it('never turns a real word into a different one ("pills" is not "bills")', () => {
    for (const w of ['pills', 'hitting', 'poison', 'trapped', 'fleeing', 'overdue', 'mediation', 'hopeless', 'addition', 'heroine', 'dientes']) {
      expect(engine.guess(w), w).toBe(w);
    }
    expect(engine.guess('stampes')).toBe('stamps');
    expect(engine.guess('methadon')).toBe('methadone');
  });

  it('a search in quotes is taken exactly as typed', () => {
    expect(engine.search('"dentst"').corrected).toBe('');
  });

  it('a long message still gets the safety handling from words near the end', () => {
    const r = engine.search('hi i am looking for some help for me and my kids because my husband beat me');
    expect(r.safety).toBe(true);
    expect(r.results[0].id).toBe('dv');
  });

  it('cost and place words never break a safety phrase that shares a word', () => {
    for (const q of ['not insured and not safe', 'afraid of him need help free of charge']) {
      const r = engine.search(q);
      expect(r.safety, q).toBe(true);
      expect(r.results[0].id, q).toBe('dv');
    }
  });

  it('a lone cost word still means its everyday thing ("uninsured" finds clinics)', () => {
    const r = engine.search('uninsured');
    expect(r.results.map((l) => l.id)).toContain('clinic');
    expect(r.lowCost).toBe(true);
  });

  it('generic words ("benefits") still search when nothing else was typed', () => {
    const p = globalThis.SADKSearch.create([L('ui', 'Employment', 'Unemployment Benefits Line'), L('x', 'Food', 'Pantry')], words);
    expect(p.search('benefits').results.map((l) => l.id)).toEqual(['ui']);
  });

  it('a town is a wish, not a need: nearby help first, nothing hidden', () => {
    const towns = { Granville: 'Washington', 'Glens Falls': 'Warren' };
    const p = globalThis.SADKSearch.create([
      L('far', 'Food', 'Pantry Far', { town: 'Glens Falls', serves_counties: ['Warren'] }),
      L('near', 'Food', 'Pantry Near', { town: 'Granville', serves_counties: ['Washington'] }),
      L('doc', 'Medical', 'Granville Doctor', { town: 'Granville', serves_counties: ['Washington'] }),
    ], words, { towns, counties: ['Warren', 'Washington'] });
    const r = p.search('food pantry granville');
    expect(r.results.map((l) => l.id)).toEqual(['near', 'far']);
    expect(r.places).toEqual(['Granville']);
    expect(p.search('granville').results.map((l) => l.id)).toEqual(['doc', 'near']);
  });

  it('cost words move free and low-cost help up without hiding the rest', () => {
    const p = globalThis.SADKSearch.create([
      L('paid', 'Dental', 'Alpha Dentist', { cost: ['Insurance'] }),
      L('free', 'Dental', 'Zeta Dental Clinic', { cost: ['Sliding scale', 'Uninsured OK'] }),
    ], words);
    const r = p.search('no insurance dentist');
    expect(r.results.map((l) => l.id)).toEqual(['free', 'paid']);
    expect(r.lowCost).toBe(true);
    expect(p.search('dentist').results[0].id).toBe('paid');
  });

  it('a child or elder abuse search finds the hotline and APS, not every DV program, and keeps the quick exit', () => {
    const p = globalThis.SADKSearch.create([
      L('dv', 'Domestic Violence', 'Partner Abuse Hotline'),
      L('cps', 'Crisis Help', 'Child Abuse and Maltreatment Hotline'),
      L('aps', 'Social Services', 'Adult Protective Services (APS)'),
    ], words);
    const child = p.search('child abuse');
    expect(child.results[0].id).toBe('cps');
    expect(child.safety).toBe(true);
    expect(p.search('elder abuse').results[0].id).toBe('aps');
    expect(p.search('he beat me').results[0].id).toBe('dv');
  });

  it('general help comes before specialists unless the search names the specialty', () => {
    const p = globalThis.SADKSearch.create([
      L('ortho', 'Dental', 'Adirondack Orthodontics', { tags: ['dentist', 'orthodontist'] }),
      L('gen', 'Dental', 'Zeta Family Dentist', { tags: ['dentist'] }),
    ], words);
    expect(p.search('dentist').results.map((l) => l.id)).toEqual(['gen', 'ortho']);
    expect(p.search('orthodontist').results[0].id).toBe('ortho');
  });

  it('offices outside the area come after local ones on ties', () => {
    const p = globalThis.SADKSearch.create([
      L('albany', 'Legal Help', 'Aardvark Legal Aid', { town: 'Albany' }),
      L('local', 'Legal Help', 'Zeta Legal Aid', { town: 'Glens Falls' }),
    ], words, { towns: { 'Glens Falls': 'Warren' }, counties: ['Warren'] });
    expect(p.search('lawyer').results.map((l) => l.id)).toEqual(['local', 'albany']);
  });

  it('a pasted paragraph stays fast: only the first 12 words are searched', () => {
    const long = Array.from({ length: 400 }, (_, i) => `zq${i}x`).join(' ');
    const t0 = Date.now();
    engine.search(long);
    expect(Date.now() - t0).toBeLessThan(1000);
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
