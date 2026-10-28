// Make (or refresh) the public, open-source copy of this project in a separate
// folder, with only an allow-list of code, neutral settings, and none of the
// owner's planning docs, data or secrets. Then scan it for anything private.
//   node scripts/publish-public.mjs [targetFolder]            build + scan only
//   node scripts/publish-public.mjs [targetFolder] --commit   also git-commit there
// Pushing to GitHub is a separate step the owner approves (it publishes).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const target = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '../resource-directory-public');
const commit = process.argv.includes('--commit');

const COPY = [
  'src', 'public', 'migrations', 'test',
  'scripts/apply-region.mjs', 'scripts/add-live.mjs', 'scripts/update-live.mjs', 'scripts/prepare-additions.mjs',
  'scripts/medicaid-providers.mjs', 'scripts/privacy-check.mjs', 'scripts/seed-local.mjs', 'scripts/backup.mjs',
  'scripts/backup-to-sql.mjs', 'scripts/live-check.mjs', 'scripts/link-check.mjs', 'scripts/search-check.mjs', 'scripts/read-xlsx.mjs', 'scripts/publish-public.mjs',
  'package.json', 'package-lock.json', 'vitest.config.js', '.gitignore', 'data/README.md',
];
const FROM_TEMPLATE = { 'open-source/README.md': 'README.md', 'open-source/LICENSE': 'LICENSE', 'open-source/SETUP.md': 'SETUP.md', 'open-source/wrangler.jsonc': 'wrangler.jsonc' };

// Fresh copy each time (keep the target's .git history).
mkdirSync(target, { recursive: true });
for (const name of readdirSync(target)) if (name !== '.git') rmSync(join(target, name), { recursive: true, force: true });
for (const p of COPY) {
  if (!existsSync(p)) continue;
  mkdirSync(join(target, p, '..'), { recursive: true });
  cpSync(p, join(target, p), { recursive: true });
}
for (const [from, to] of Object.entries(FROM_TEMPLATE)) cpSync(from, join(target, to));

// Tests for scripts that stay private (for example the local Medicaid plan
// checks) would fail in the public copy: leave them out.
for (const name of readdirSync(join(target, 'test'))) {
  if (!name.endsWith('.js')) continue;
  const text = readFileSync(join(target, 'test', name), 'utf8');
  const needs = [...text.matchAll(/from '\.\.\/(scripts\/[\w-]+\.mjs)'/g)].map((m) => m[1]);
  if (needs.some((f) => !COPY.includes(f))) rmSync(join(target, 'test', name));
}

// Neutral versions of local-only pieces.
writeFileSync(join(target, 'src/local/internal-terms.js'), `// Words that mark something as internal to a partner organization (for
// example a hospital's unit names or staff shorthand). Public listing fields
// containing them get a warning. Add your own, e.g. [/\\bABC Hospital unit\\b/i].
export const INTERNAL_TERMS = [];
`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.name = 'community-resource-directory';
pkg.private = true;
for (const [k, v] of Object.entries(pkg.scripts)) {
  const file = (v.match(/scripts\/[\w-]+\.mjs/) || [])[0];
  if (file && !COPY.includes(file)) delete pkg.scripts[k];
}
writeFileSync(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// Scan everything that will be published.
const secrets = [];
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^(ADMIN_EMAIL|FORWARD_TO|IP_SALT|TURNSTILE_SECRET_KEY)=(.+)$/);
    if (m && m[2].trim().length > 6 && !/^1x0+AA$/.test(m[2].trim())) secrets.push(m[2].trim());
  }
}
const wranglerReal = readFileSync('wrangler.jsonc', 'utf8');
for (const key of ['database_id', 'POLICY_AUD', 'TEAM_DOMAIN']) {
  const m = wranglerReal.match(new RegExp(`"${key}":\\s*"([^"]+)"`));
  if (m && !/^0+-/.test(m[1])) secrets.push(m[1]);
}
const BANNED = [/\bGFH\b/, /glensfallshosp/i, /case ?worker at/i, /\bICM\b/];
const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const rel = p.slice(target.length + 1);
    if (/^(data\/(?!README\.md$)|backups\/)|\.dev\.vars/.test(rel)) problems.push(`${rel}: private folder or file`);
    const text = readFileSync(p, 'utf8');
    for (const s of secrets) if (text.includes(s)) problems.push(`${rel}: contains a private setting or secret`);
    for (const re of BANNED) if (re.test(text) && !rel.endsWith('publish-public.mjs')) problems.push(`${rel}: contains "${text.match(re)[0]}"`);
  }
}
walk(target);
if (problems.length) {
  console.error(`NOT SAFE TO PUBLISH (${problems.length}):`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Public copy built in ${target} and scanned: nothing private found.`);

if (commit) {
  const git = (...a) => execFileSync('git', a, { cwd: target, encoding: 'utf8' });
  if (!existsSync(join(target, '.git'))) git('init', '-b', 'main');
  git('add', '-A');
  const status = git('status', '--porcelain');
  if (!status.trim()) { console.log('No changes to commit.'); process.exit(0); }
  const source = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  git('commit', '-q', '-m', `Sync from main project (${source})`);
  console.log('Committed in the public copy. Push it only after the owner approves.');
}
