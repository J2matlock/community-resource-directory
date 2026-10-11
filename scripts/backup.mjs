// Make a backup of the LIVE database onto this computer (backups/, never in git).
//   npm run backup
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, readFileSync } from 'node:fs';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const file = `backups/${stamp}.sql`;
mkdirSync('backups', { recursive: true });
execFileSync('npx', ['wrangler', 'd1', 'export', 'DB', '--remote', '--output', file], { stdio: 'inherit' });
const size = statSync(file).size;
const listings = (readFileSync(file, 'utf8').match(/INSERT INTO "?listings"? /g) || []).length;
if (!size || !listings) {
  console.error(`Backup ${file} looks empty (${size} bytes, ${listings} listings). Check it before relying on it.`);
  process.exit(1);
}
console.log(`Backup saved: ${file} (${Math.round(size / 1024)} KB, ${listings} listings).`);
