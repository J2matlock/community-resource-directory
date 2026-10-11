// The email sent to the owner for each provider request. Plain text only, so
// nothing typed into the form can become a link, image or script (rule 5).

import { BARRIERS } from './validate.js';

const LABELS = [
  ['organization', 'Organization'], ['correction', 'What needs to be corrected'], ['services', 'Services'], ['eligibility', 'Who can get help, and ages'],
  ['age_groups', 'Age groups'], ['cost', 'Cost'], ['medicaid', 'Insurance accepted'], ['counties', 'Counties served'],
  ['address', 'Address'], ['hours', 'Hours'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['how_to_start', 'How clients start'], ['submitter_name', 'Submitted by'], ['submitter_contact', 'Submitter contact'],
  ['ok_to_publish', 'OK to publish'],
];

// One line, no control characters: safe for an email subject.
export function oneLine(s, max = 120) {
  return String(s ?? '').replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Breaks up web addresses so mail apps don't turn them into clickable links:
// "https://evil.example" becomes "https[:]//evil[.]example".
export function defang(s) {
  return String(s ?? '')
    .replace(/\b(https?):\/\//gi, '$1[:]//')
    .replace(/\b([a-z0-9-]+)\.(?=[a-z]{2,}\b)/gi, '$1[.]');
}

export function requestEmail(id, f, adminUrl) {
  const value = (k) => {
    if (k === 'address') return f.no_public_address ? 'No public address' : f.address;
    if (k === 'ok_to_publish') return f.ok_to_publish ? 'Yes' : 'No';
    return Array.isArray(f[k]) ? f[k].join(', ') : f[k];
  };
  const kind = f.request_type === 'correction' ? 'Correction request' : 'New listing request';
  const lines = [
    `${kind} #${id}`,
    '',
    'Typed by the provider. Not checked yet: call or email them to confirm before listing.',
    'Web addresses below are broken up on purpose so they can\'t be clicked.',
    '',
  ];
  for (const [k, label] of LABELS) {
    const v = value(k);
    if (!v) continue;
    lines.push(`${label}:`);
    lines.push(...defang(v).split('\n').map((l) => `  ${l}`));
    lines.push('');
  }
  lines.push(`Review it in the admin panel: ${adminUrl}`);
  return {
    subject: `${f.request_type === 'correction' ? 'Correction request' : 'Listing request'} #${id}: ${oneLine(f.organization, 80)}`,
    text: lines.join('\n'),
  };
}

// Anonymous barrier report: plain text only, nothing identifying is collected.
export function barrierEmail(id, f) {
  const labels = Object.fromEntries(BARRIERS);
  const lines = [
    `Barrier report #${id} (anonymous)`,
    '',
    `County: ${f.county}`,
    f.reporter ? `Reported: ${f.reporter}` : '',
    '',
    'Barriers:',
    ...f.barriers.map((b) => `  - ${labels[b] ?? b}`),
    '',
    f.comment ? 'Comment (only you see this; web addresses broken up on purpose):' : '',
    ...(f.comment ? defang(f.comment).split('\n').map((l) => `  ${l}`) : []),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return { subject: `Barrier report #${id}: ${oneLine(f.county, 40)}`, text: lines.join('\n') };
}

// Anonymous "Don't see the help you need?" message: plain text only.
export function suggestionEmail(id, f) {
  const lines = [
    `Help suggestion #${id} (anonymous)`,
    '',
    `County: ${f.county || 'Not given'}`,
    '',
    'What they were looking for (web addresses broken up on purpose):',
    ...defang(f.looking_for).split('\n').map((l) => `  ${l}`),
  ];
  return { subject: `Help suggestion #${id}: ${oneLine(defang(f.looking_for), 60)}`, text: lines.join('\n') };
}
