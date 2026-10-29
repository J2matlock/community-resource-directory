// The owner's own edits win over research updates (docs/ACCURACY-RULES.md).
// Made-up history rows only.

import { describe, it, expect } from 'vitest';
import { isOwnerSrc, ownerSetFields } from '../scripts/owner-edits-lib.mjs';

const row = (listing_id, field, new_value, changed_by, changed_at) => ({ listing_id, field, new_value, changed_by, changed_at });

describe('fields the owner set last', () => {
  it('counts admin-panel saves and changes the owner asked Claude to make', () => {
    const owned = ownerSetFields([
      row('a', 'hours', 'Mon 9-5', 'owner@example.org', '2026-10-12T10:00:00Z'),
      row('a', 'phone', '(518) 555-0100', 'owner via Claude 2026-10-13', '2026-10-13T10:00:00Z'),
      row('a', 'website', 'https://example.org', 'research update 2026-10-13', '2026-10-13T11:00:00Z'),
    ]);
    expect([...owned.get('a').keys()].sort()).toEqual(['hours', 'phone']);
    expect(owned.get('a').get('hours').value).toBe('Mon 9-5');
  });

  it('only the latest change to a field counts', () => {
    const owned = ownerSetFields([
      row('a', 'hours', 'Mon 9-5', 'owner@example.org', '2026-10-12T10:00:00Z'),
      row('a', 'hours', 'Mon 9-4', 'research update 2026-10-20', '2026-10-20T10:00:00Z'),
      row('b', 'hours', 'old', 'research update 2026-10-10', '2026-10-10T10:00:00Z'),
      row('b', 'hours', 'Tue 1-3', 'owner@example.org', '2026-10-21T10:00:00Z'),
    ]);
    expect(owned.has('a')).toBe(false);
    expect(owned.get('b').get('hours').value).toBe('Tue 1-3');
  });

  it('a category or plan rename is not an edit of each listing', () => {
    const owned = ownerSetFields([
      row('a', 'category', 'Optometrists', 'owner@example.org', '2026-10-15T10:00:00Z'),
      row('b', 'category', 'Optometrists', 'owner@example.org', '2026-10-15T10:00:00Z'),
      row('c', 'medicaid_plans', 'Fidelis', 'owner@example.org (list rename)', '2026-10-16T10:00:00Z'),
      row('d', 'category', 'Food', 'owner@example.org', '2026-10-17T10:00:00Z'),
    ]);
    expect([...owned.keys()]).toEqual(['d']);
  });

  it('a batch of changes the owner asked Claude to make still counts for each listing', () => {
    const owned = ownerSetFields([
      row('a', 'hours', 'Mon 9-5', 'owner via Claude 2026-10-12', '2026-10-12T20:45:47Z'),
      row('b', 'phone', '(518) 555-0100', 'owner via Claude 2026-10-12', '2026-10-12T20:45:47Z'),
    ]);
    expect([...owned.keys()].sort()).toEqual(['a', 'b']);
  });

  it('research and import rows never count', () => {
    expect(ownerSetFields([
      row('a', 'created', 'A', 'research import 2026-10-10', '2026-10-10T10:00:00Z'),
      row('a', 'hours', 'x', 'research update 2026-10-11', '2026-10-11T10:00:00Z'),
    ]).size).toBe(0);
  });

  it('knows an owner answer from a website source', () => {
    expect(isOwnerSrc('owner answer in data/verification-questions.md (2026-10-10)')).toBe(true);
    expect(isOwnerSrc('Owner approved website version 2026-10-28')).toBe(true);
    expect(isOwnerSrc('owner (To review, 2026-10-12): keep it')).toBe(true);
    expect(isOwnerSrc('owner-approved date fix')).toBe(true);
    expect(isOwnerSrc('owner asked 2026-10-28: new phone')).toBe(true);
    expect(isOwnerSrc("Owner's Facebook page says Mon 9-4")).toBe(false);
    expect(isOwnerSrc('ownership records, county site')).toBe(false);
    expect(isOwnerSrc('https://example.org/hours (owner gave this link)')).toBe(false);
    expect(isOwnerSrc(undefined)).toBe(false);
  });
});
