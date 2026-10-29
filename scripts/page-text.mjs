// Browser reader: opens a page in a real (headless) Chromium browser and returns
// what a person would see. For websites that refuse plain automated requests
// (403, "verify you are human", pages built by JavaScript).
//   node scripts/page-text.mjs <url> [--find 'hours|Monday|closed'] [--wait 3] [--with-me]
// Used by /refresh-info and by `npm run link-check` (second look at blocked links).
//
// Polite by design: the browser's own honest identity (owner's choice
// 2026-10-28: no disguise as a regular desktop Chrome), one page at a time
// (callers pause between pages), and it never tries to get past a login,
// paywall or bot check. If a "checking your browser" page doesn't clear by
// itself within a few seconds, it reports `challenged` and stops there.
//
// --with-me ("check with me", owner's choice 2026-10-28): opens a visible
// browser window on the owner's computer instead. When a site shows its human
// check, the script waits (up to 2 minutes) for the OWNER to complete it in the
// window, then reads the page. The browser keeps its cookies in
// data/browser-profile/ (local only), so one pass usually covers that site's
// other pages for a while. The script itself never clicks or solves a check.
// Uses Playwright's Chromium (already installed for pnds:check); if it's
// missing: `npx playwright install chromium` (free, about 150 MB, ask first).

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHALLENGE = /just a moment|checking your browser|verify you are human|are you a robot|attention required|captcha|access denied|request unsuccessful|ddos protection|bot detection|press (and|&) hold/i;

// Path to Playwright's Chromium, or null if it isn't installed.
export function findChromium() {
  const root = `${homedir()}/.cache/ms-playwright`;
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    const sub = readdirSync(`${root}/${d}`).find((n) => n.startsWith('chrome-headless-shell'));
    if (sub && existsSync(`${root}/${d}/${sub}/chrome-headless-shell`)) return `${root}/${d}/${sub}/chrome-headless-shell`;
  }
  return null;
}

// Path to Playwright's full Chromium (used for the visible window), or null.
export function findFullChromium() {
  const root = `${homedir()}/.cache/ms-playwright`;
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const sub = readdirSync(`${root}/${d}`).find((n) => n.startsWith('chrome-linux'));
    if (sub && existsSync(`${root}/${d}/${sub}/chrome`)) return `${root}/${d}/${sub}/chrome`;
  }
  return null;
}

// A short page whose title or opening text is a bot check, not the real page.
export const looksLikeChallenge = (title, text) => CHALLENGE.test(`${title}\n${String(text).slice(0, 1500)}`) && String(text).length < 3000;

// Opens one browser for many reads. read(url) returns
// { ok, status, finalUrl, title, text, challenged, error }.
export async function openReader({ timeoutMs = 25_000, settleMs = 3_000, challengeWaitMs = 8_000, withMe = false, ownerWaitMs = 120_000 } = {}) {
  const executablePath = withMe ? findFullChromium() : findChromium();
  if (!executablePath) throw new Error('No Chromium browser installed (npx playwright install chromium, about 150 MB; ask the owner first).');
  if (withMe && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('--with-me needs a desktop screen to show the browser window.');
  const { chromium } = await import('playwright-core');
  let browser, context;
  if (withMe) {
    // A plain visible browser, as the owner would use it (its own identity, no disguise).
    context = await chromium.launchPersistentContext(`${ROOT}/data/browser-profile`, { headless: false, executablePath, locale: 'en-US', viewport: null });
  } else {
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 900 } });
  }
  const readNow = async (page) => [await page.title().catch(() => ''), await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')];

  async function read(url) {
    const page = await context.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(settleMs);
      let [title, text] = await readNow(page);
      // Some bot checks clear by themselves after a few seconds, as they do for a person.
      if (looksLikeChallenge(title, text)) {
        await page.waitForTimeout(challengeWaitMs);
        [title, text] = await readNow(page);
      }
      // Check with me: the owner completes the human check in the window; we only wait.
      if (withMe && looksLikeChallenge(title, text)) {
        await page.bringToFront().catch(() => {});
        console.error(`\n  >> ${new URL(url).hostname} is showing a human check in the browser window. Please complete it there; waiting up to ${ownerWaitMs / 60_000} minutes...`);
        const until = Date.now() + ownerWaitMs;
        while (Date.now() < until && looksLikeChallenge(title, text)) {
          await page.waitForTimeout(2_000);
          [title, text] = await readNow(page);
        }
        if (!looksLikeChallenge(title, text)) {
          await page.waitForTimeout(settleMs);
          [title, text] = await readNow(page);
          console.error('  >> Thanks, got it. Carrying on.');
        } else console.error('  >> No luck in time; leaving this site for checking by hand.');
      }
      const challenged = looksLikeChallenge(title, text);
      const status = res?.status() ?? 0;
      return { ok: status < 400 && !challenged && text.trim().length > 0, status, finalUrl: page.url(), title, text, challenged };
    } catch (err) {
      return { ok: false, status: 0, finalUrl: url, title: '', text: '', challenged: false, error: /Timeout/i.test(err.message) ? 'timeout' : err.message.split('\n')[0] };
    } finally {
      await page.close().catch(() => {});
    }
  }
  return { read, close: () => (browser ?? context).close() };
}

// ---- Command line ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
  const url = args.find((a, i) => !a.startsWith('--') && !['--find', '--wait'].includes(args[i - 1]));
  if (!url || !/^https?:\/\//.test(url)) {
    console.error("Usage: node scripts/page-text.mjs <url> [--find 'word|other'] [--wait seconds] [--with-me]");
    process.exit(1);
  }
  const reader = await openReader({ settleMs: (Number(opt('--wait')) || 3) * 1000, withMe: args.includes('--with-me') });
  try {
    const r = await reader.read(url);
    console.log(`Status ${r.status || '-'}${r.error ? ` (${r.error})` : ''}${r.challenged ? ' - still a bot check after waiting; not going further' : ''}`);
    console.log(`Address: ${r.finalUrl}\nTitle: ${r.title}\n`);
    const find = opt('--find');
    if (find) {
      const re = new RegExp(find, 'i');
      const lines = r.text.split('\n').map((l) => l.trim()).filter((l) => l && re.test(l));
      console.log(lines.length ? lines.join('\n') : `(no lines matching ${find})`);
    } else console.log(r.text.trim());
  } finally {
    await reader.close();
  }
}
