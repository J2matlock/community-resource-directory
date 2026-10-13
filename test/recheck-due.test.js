// When a listing is due for its next check: 3 months after the last check for
// fast-changing categories, 12 months otherwise, landing on the same day of
// the month (or the last day, when that month is shorter).

import { describe, it, expect } from 'vitest';
import { recheckDueDate } from '../src/db/admin.js';

describe('Re-check due date', () => {
  it('a normal date moves by whole months', () => {
    expect(recheckDueDate({ category: 'Dental', last_verified: '2026-03-15' })).toBe('2027-03-15');
    expect(recheckDueDate({ category: 'Food', last_verified: '2026-03-15' })).toBe('2026-06-15');
  });

  it('Jan 31 lands on Apr 30 (fast category), not May 1', () => {
    expect(recheckDueDate({ category: 'Food', last_verified: '2026-01-31' })).toBe('2026-04-30');
  });

  it('Jan 31 lands on Jan 31 the next year (12 months)', () => {
    expect(recheckDueDate({ category: 'Dental', last_verified: '2026-01-31' })).toBe('2027-01-31');
  });

  it('a leap day moves to Feb 28 the next year, and Nov 30 to Feb 28/29', () => {
    expect(recheckDueDate({ category: 'Dental', last_verified: '2028-02-29' })).toBe('2029-02-28');
    expect(recheckDueDate({ category: 'Food', last_verified: '2027-11-30' })).toBe('2028-02-29');
  });

  it('uses the later of the two check dates, and is blank with neither', () => {
    expect(recheckDueDate({ category: 'Dental', last_verified: '2026-01-10', last_checked_online: '2026-02-10' })).toBe('2027-02-10');
    expect(recheckDueDate({ category: 'Dental', last_verified: '', last_checked_online: '' })).toBe('');
  });
});
