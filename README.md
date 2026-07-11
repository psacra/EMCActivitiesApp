# EMC Trail Log

A small, free/open-source app for recording and curating EMC's hikes and MTB rides —
sourced from Strava (each member connects their own account) and/or GPX file uploads,
then tagged, described, and organized for the group to browse.

## Why not just sync a Strava Club?

Strava's Club Activities endpoint is being **deprecated on Sept 1, 2026**, and even
before that it only returned rounded/summary data with no dates or activity IDs —
not usable for a real log. Instead, each member who wants their activities included
connects their **own** Strava account (standard OAuth), and the app pulls their full
activity data. You (or any designated curator) then decide which activities actually
count as EMC outings and enrich them with tags, descriptions, and participants.

GPX upload is a full parallel path for pre-Strava trips or people who'd rather not
connect an account.

## Stack (all free / open source)

- **Backend:** Node.js + Express
- **Database:** PostgreSQL (free tier: Supabase or Neon; or self-hosted)
- **Frontend:** Plain HTML/CSS/JS (no build step) + Leaflet + OpenStreetMap tiles
- **Hosting:** Render or Fly.io free tier for the backend; the frontend is static
  and can be served from the same box, Render's static sites, or GitHub Pages

## Project layout

```
server/     Express API: Strava OAuth, activity sync, GPX parsing, tagging/curation
client/     Static frontend: filterable log, map view, curation drawer
```

## 1. Create a Strava API application

1. Go to https://www.strava.com/settings/api and create an app.
2. Note the **Client ID** and **Client Secret**.
3. Once you know your deployed backend URL, set "Authorization Callback Domain" to
   its hostname (no https://, no path), e.g. `emc-log.onrender.com`.
4. Check your tier at the same settings page. With 10 or fewer EMC members
   connecting, the free **Standard Tier** (self-upgradable, up to 10 athletes) is
   enough — note Strava currently requires an active Strava subscription for
   Standard Tier apps after a grace period.

## 2. Create a free Postgres database

Easiest options: [Supabase](https://supabase.com) or [Neon](https://neon.tech) —
both have a free tier. Copy the connection string; you'll use it as `DATABASE_URL`.

## 3. Configure and run the backend

```bash
cd server
cp .env.example .env
# edit .env: DATABASE_URL, STRAVA_CLIENT_ID/SECRET, PUBLIC_SERVER_URL, PUBLIC_CLIENT_URL,
# and optionally CURATOR_PASSWORD to lock down editing
npm install
npm start
```

The schema is created automatically on first boot.

## 4. Configure and run the frontend

Edit `client/config.js`:

```js
window.EMC_API_BASE = "https://your-backend.onrender.com";
window.EMC_CURATOR_PASSWORD = "same-value-as-server-CURATOR_PASSWORD"; // optional
```

Then just serve the `client/` folder as static files — locally you can use:

```bash
cd client
npx serve .
```

## 5. Deploy for real (free tier)

- **Backend on Render:** New Web Service → point at `server/` → build command
  `npm install`, start command `npm start` → add the same env vars from `.env`.
- **Frontend on Render (Static Site) or GitHub Pages:** point at `client/`, no
  build step needed.
- Update `PUBLIC_SERVER_URL` / `PUBLIC_CLIENT_URL` on the backend and
  `EMC_API_BASE` in `client/config.js` to the real deployed URLs, then redeploy.
- Update the Strava app's Authorization Callback Domain to match the deployed
  backend's hostname.

## Using it

- **"Connect Strava"** — each member does this once. Their existing hikes/rides
  (Hike, Walk, Ride, MountainBikeRide, GravelRide, Run, TrailRun) are imported.
- **"Add GPX"** — upload a `.gpx` file directly for anything not on Strava.
- Click any card to open the curation drawer: rename, describe, tag, list
  participants, set the type, and mark it "curated" so it's highlighted in the log.
- The left panel filters by text, type, tag, curated-only, and date range.

## Extending it later

- Add a "sync all" cron/scheduled job (e.g. Render Cron Job hitting
  `POST /api/auth/athletes/:id/sync` for each connected athlete) for automatic
  ongoing sync instead of just at connect-time.
- Swap the single shared `CURATOR_PASSWORD` for per-user accounts if the group
  grows and you want individual edit history.
- Add photo uploads per activity (object storage like Cloudflare R2's free tier
  works well here).
