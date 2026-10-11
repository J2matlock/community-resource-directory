# Setting up a directory for your community

This guide assumes no developer experience. It takes an afternoon. You'll need a computer with [Node.js](https://nodejs.org) (version 20 or newer) and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. A domain name costs about $10–20 a year.

## 1. Get the code

```
git clone https://github.com/J2matlock/community-resource-directory.git my-directory
cd my-directory
npm install
```

## 2. Describe your area

Open `src/region.js` and change:

- `siteName`, `domain`, `tagline`
- `counties`: the counties people can filter by
- `townCounty`: towns and the county each is in (used to fill in counties automatically)
- `outOfAreaTowns` and `outOfAreaNote`: nearby cities outside your area
- `fallback`: your local 211 (or other help line) and its website
- `crisis`: the red crisis bar. Keep 988 and 911; replace the domestic violence hotlines with your local 24-hour lines.

Then run:

```
npm run apply-region
```

This updates every page. Also edit `public/about.html` in your own words, and the `<meta name="description">` lines at the top of each page in `public/`.

## 3. Try it on your computer

Create a file named `.dev.vars` (it is never uploaded) with:

```
ADMIN_EMAIL=you@example.org
LOCAL_DEV_ADMIN=true
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TURNSTILE_SITE_KEY=1x00000000000000000000AA
IP_SALT=any-long-random-text
FORWARD_TO=you@example.org
```

Then:

```
npm run seed:sample   # practice listings
npm run dev
```

Open http://localhost:8787 for the directory and http://localhost:8787/admin/ for the admin panel. (`LOCAL_DEV_ADMIN` skips the login on your own computer only; it never works on a real address.)

## 4. Cloudflare setup

1. **Log in Wrangler:** `npx wrangler login`
2. **Database:** `npx wrangler d1 create resource-directory`, then put the `database_id` it prints into `wrangler.jsonc`, and run `npx wrangler d1 migrations apply DB --remote`.
3. **Domain:** buy or move your domain to Cloudflare, and put it in `wrangler.jsonc` (`routes`, `EMAIL_FROM`, `SUPPORT_EMAIL`).
4. **Admin login (Cloudflare Access / Zero Trust):** create a self-hosted application covering `your-domain.org/admin*` and `your-domain.org/api/admin*` (and the whole workers.dev address while you're testing), with a policy allowing only your email. Put your team domain and the application's AUD tag into `TEAM_DOMAIN` and `POLICY_AUD`.
5. **Spam check (Turnstile):** add a widget for your domain; put the site key in `TURNSTILE_SITE_KEY`.
6. **Email (Email Routing):** turn it on for your domain, verify your personal inbox as a destination, and create `support@your-domain.org` forwarding to it.
7. **Secrets:** run each and paste the value when asked:
   ```
   npx wrangler secret put ADMIN_EMAIL
   npx wrangler secret put FORWARD_TO
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put IP_SALT
   ```

## 5. Add your listings

Use the admin panel's "Add a listing", or prepare a file of listings and load it with `node scripts/prepare-additions.mjs` and `node scripts/add-live.mjs` (see the comments at the top of each script). If you're in New York, `npm run medicaid:report` lists dentists and eye care providers enrolled in Straight Medicaid in your counties, from the state's open data.

## 6. Go live

```
npm run check     # must pass
npm run deploy
```

While `SITE_PUBLIC` is `"false"`, only you can see the site. When you're ready, set it to `"true"`, deploy again, and check every address while logged out (`npm run live-check -- https://your-domain.org --launched`). Turn off `workers_dev` once your domain works.

## Keeping it healthy

- Every listing shows when it was last checked; the admin "Due for re-check" view lists anything older than 11 months.
- A backup is emailed to you every Monday; use "Export to Excel" before big changes.
- Run `npm run check` before every deploy.
