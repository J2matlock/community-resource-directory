// Rule 1: no client information, ever. Saves that look like they contain a
// client's details are refused, in every field including private notes.

import { describe, it, expect, beforeEach } from 'vitest';
import { call, token, resetDb, countRows, validListing } from './helpers.js';
import { validateListing } from '../src/validate.js';

const lists = { categories: ['Food'], plans: [] };

describe('Rule 1: no client information', () => {
  beforeEach(resetDb);

  const examples = {
    'a Social Security number': { private_notes: 'Client SSN 123-45-6789' },
    'a date of birth': { private_notes: 'DOB: 4/12/1961' },
    'a written-out date of birth': { description: 'date of birth 1961-04-12' },
    'a medical record number': { private_notes: 'MRN 00123456' },
    'a Medicaid ID': { private_notes: 'Medicaid AB12345C' },
  };

  for (const [label, fields] of Object.entries(examples)) {
    it(`refuses ${label}`, async () => {
      const { errors } = validateListing(validListing(fields), lists);
      expect(Object.keys(errors).length).toBeGreaterThan(0);

      const before = await countRows('listings');
      const res = await call('/api/admin/listings', { method: 'POST', as: await token(), body: validListing(fields) });
      expect(res.status).toBe(422);
      expect(await countRows('listings')).toBe(before);
    });
  }

  it('refuses client information in category and plan names', async () => {
    const res = await call('/api/admin/lists/categories', { method: 'POST', as: await token(), body: { name: 'Client 123-45-6789' } });
    expect(res.status).toBe(422);
  });

  it('allows fill-in-the-blank templates like [XX/XX/XXXX]', () => {
    const { errors } = validateListing(validListing({
      private_notes: 'Script: Last four of his social is [XXXX], date of birth [XX/XX/XXXX].',
    }), lists);
    expect(errors).toEqual({});
  });

  it('allows ordinary phone numbers and dates', () => {
    const { errors } = validateListing(validListing({ phone: '(518) 555-0123 x12', review_by: '2027-01-31', hours: 'Mon–Fri, 9–5' }), lists);
    expect(errors).toEqual({});
  });
});
