// Made-up practice listings for tests and local development. Not real
// resources, not real people. 555-01xx numbers are reserved for fiction.

export const SAMPLE_CATEGORIES = ['Food', 'Housing and Shelter', 'Dental', 'Legal Help'];
export const SAMPLE_PLANS = ['Straight Medicaid', 'United Healthcare', 'Fidelis', 'Medicaid (call to check plan)'];

// Any text containing this marker is private and must never reach the public.
export const PRIVATE_MARKER = 'PRIVATE-MARKER-7f3a';

export const SAMPLE_LISTINGS = [
  {
    id: 'sample-food-pantry', name: 'Sample Food Pantry', organization: 'Sample Community Group', category: 'Food',
    tags: ['food pantry', 'groceries'], phone: '(518) 555-0101', fax: '', email: 'info@example.org', website: 'https://example.org/pantry',
    address: '1 Example Street, Glens Falls, NY 12801', town: 'Glens Falls', serves_counties: ['Warren'],
    hours: 'Tuesdays, 10 AM–1 PM', eligibility: 'Warren County residents', age_groups: [], cost: ['Free'], medicaid_plans: [],
    medicaid_notes: '', description: 'Practice listing: emergency groceries once a month.',
    private_notes: `${PRIVATE_MARKER} staff contact: Pat Example, direct line (518) 555-0199`,
    status: 'Active', review_by: '', visibility: 'Public', last_verified: '2026-01-15', retired: 0,
  },
  {
    id: 'sample-dental-clinic', name: 'Sample Dental Clinic', organization: '', category: 'Dental',
    tags: ['dentist'], phone: '(518) 555-0102', fax: '(518) 555-0103', email: '', website: '',
    address: '2 Example Avenue, Hudson Falls, NY 12839', town: 'Hudson Falls', serves_counties: ['Washington'],
    hours: '', eligibility: '', age_groups: ['Adults', 'Children'], cost: ['Insurance'], medicaid_plans: ['Straight Medicaid', 'Fidelis'],
    medicaid_notes: 'Does not take United Healthcare.', description: 'Practice listing: dentist that accepts Medicaid.',
    private_notes: '', status: 'Temporarily closed', review_by: '2026-11-01', visibility: 'Public', last_verified: '', retired: 0,
  },
  {
    id: 'sample-internal-contacts', name: 'Sample Internal Contacts', organization: '', category: 'Housing and Shelter',
    tags: ['internal'], phone: '', fax: '', email: '', website: '', address: '', town: '', serves_counties: ['Warren'],
    hours: '', eligibility: '', age_groups: [], cost: [], medicaid_plans: [], medicaid_notes: '',
    description: `${PRIVATE_MARKER} internal-only listing description`,
    private_notes: `${PRIVATE_MARKER} internal notes`, status: 'Active', review_by: '', visibility: 'Internal', last_verified: '', retired: 0,
  },
  {
    id: 'sample-retired-shelter', name: 'Sample Retired Program', organization: '', category: 'Housing and Shelter',
    tags: ['shelter'], phone: '(518) 555-0104', fax: '', email: '', website: '', address: '', town: '', serves_counties: ['Saratoga'],
    hours: '', eligibility: '', age_groups: [], cost: [], medicaid_plans: [], medicaid_notes: '',
    description: `${PRIVATE_MARKER} retired listing description`, private_notes: '', status: 'Active', review_by: '',
    visibility: 'Public', last_verified: '', retired: 1,
  },
  {
    id: 'sample-legal-help', name: 'Sample Legal Help', organization: '', category: 'Legal Help',
    tags: ['lawyer', 'legal aid'], phone: '(518) 555-0105 x12', fax: '', email: '', website: 'https://example.org/legal',
    address: '', town: '', serves_counties: ['Regional'], hours: 'Monday–Friday, 9 AM–5 PM', eligibility: 'Low income',
    age_groups: ['Adults', 'Seniors'], cost: ['Free'], medicaid_plans: [], medicaid_notes: '',
    description: 'Practice listing: free legal help by phone.', private_notes: `${PRIVATE_MARKER} intake tip`,
    status: 'Seasonal', review_by: '', visibility: 'Public', last_verified: '2025-09-01', retired: 0,
  },
];
