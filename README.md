# Community Resource Directory

A free, plain-language directory of local help (food, housing, health care, transportation, legal help and more) that any community can run for itself. It powers [Southern ADK Help](https://southernadkhelp.org) for Warren, Washington and Saratoga Counties, New York.

It's built to be cheap and safe to run: one Cloudflare Worker and a D1 database, which fit within Cloudflare's free plan for a county-sized directory. The only cost is a domain name.

## What it does

**For the public (no login, no tracking):**
- Search that forgives typos, category buttons with counts, and filters for county, cost, age and insurance accepted (including New York's "Straight" fee-for-service Medicaid).
- Listing cards with tap-to-call, maps, hours and who qualifies, a "copy" and "text" button, and a link for each listing.
- A printable one-page handout builder, with a QR code for each listing, and a "Share list" link for several listings at once.
- Works offline and installs to a phone's home screen: the public directory is saved on the device (never the admin panel).
- Link previews and a sitemap, so shared links show each listing's name and search engines can find every listing.
- A one-page printable flyer with a QR code and tear-off strips.
- A red crisis bar on every page, with phone-friendly buttons.
- A form for programs to request a listing or a correction (spam-checked, rate-limited).
- **Learn:** plain-language answers about benefits, each with a source.
- **Community needs:** documented service gaps, plus an anonymous "what's getting in your way" form whose public totals are rounded and hide small numbers.
- **Ways to help:** links straight to local organizations' own donation pages. The site never handles money.

**For the one owner (admin panel behind Cloudflare Access):**
- Add, edit, retire and restore listings, with full change history.
- Private notes and internal-only listings that never reach the public.
- "Due for re-check" view with a printable call sheet, requests inbox, anonymous barrier reports, Excel export and a weekly emailed backup.
- A site notice (e.g. "Code Blue shelter open tonight") shown under the crisis bar on every page, with an optional end date.
- A monthly broken-link check (`npm run link-check`).

## Privacy and safety rules built into the code

1. No client information, ever. Text that looks like a date of birth, ID number, phone or email in the wrong place is refused.
2. Domestic violence programs: office addresses only, never a shelter's location.
3. Only the owner can edit. Every admin request is checked in the Worker against Cloudflare Access (signature, issuer, audience, email), not just at the edge.
4. The public data comes from its own query that selects only public columns.
5. Everything typed into public forms is treated as untrusted: checked, size-limited, stored and emailed as plain text.
6. No analytics, ads or third-party scripts (besides Cloudflare's Turnstile spam check). Even the QR code generator and the typo-tolerant search are written for this project.

Each rule has automated tests (`npm test`).

## Make one for your community

See **[SETUP.md](SETUP.md)** for step-by-step instructions. In short:

1. Edit `src/region.js` (site name, counties, towns, crisis numbers, local 211), then run `npm run apply-region`.
2. Create a Cloudflare account, a D1 database, an Access app for `/admin`, a Turnstile widget and Email Routing.
3. Fill in `wrangler.jsonc` and the secrets, load your listings, test locally, and deploy.

The Learn page content (`public/content/learn.json`) is about New York State programs; replace or adapt it for your state.

## Tech

Plain HTML, CSS and JavaScript (no framework, no build step). Cloudflare Workers + D1 + Access + Turnstile + Email Routing. Tests use Vitest with Cloudflare's Workers test pool.

```
npm install
npm test          # all tests
npm run check     # tests + privacy checks
npm run dev       # local site at http://localhost:8787
```

## License

MIT. See [LICENSE](LICENSE). Listing data is not part of this repository; each community collects and maintains its own.
