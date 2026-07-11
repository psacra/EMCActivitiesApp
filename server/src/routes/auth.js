import { Router } from "express";
import { pool } from "../db.js";
import { getAuthorizeUrl, exchangeCodeForToken, browseAthleteActivities, importStravaActivity } from "../strava.js";

export const authRouter = Router();

function redirectUri(req) {
  return `${process.env.PUBLIC_SERVER_URL}/api/auth/strava/callback`;
}

// Step 1: send the member to Strava's consent screen.
authRouter.get("/strava/connect", (req, res) => {
  res.redirect(getAuthorizeUrl(redirectUri(req)));
});

// Step 2: Strava redirects back here with a code.
authRouter.get("/strava/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");

    const token = await exchangeCodeForToken(code);
    const { athlete, access_token, refresh_token, expires_at } = token;

    await pool.query(
      `INSERT INTO athletes (id, first_name, last_name, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at`,
      [athlete.id, athlete.firstname, athlete.lastname, access_token, refresh_token, expires_at]
    );

    // No auto-import here on purpose — the person picks which activities to
    // bring in from the "Import from Strava" browser in the app.
    res.redirect(`${process.env.PUBLIC_CLIENT_URL}/?connected=${athlete.firstname}&athleteId=${athlete.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Strava connection failed. Check server logs.");
  }
});

authRouter.get("/athletes", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, first_name, last_name, connected_at FROM athletes ORDER BY connected_at DESC"
  );
  res.json(rows);
});

// Browse an athlete's Strava activities without importing them.
// ?year=2025 restricts to that calendar year; otherwise plain paging (?page=&per_page=).
authRouter.get("/athletes/:id/strava-activities", async (req, res) => {
  try {
    const { page = 1, per_page = 30, year } = req.query;
    let before, after;
    if (year) {
      after = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
      before = Math.floor(new Date(`${Number(year) + 1}-01-01T00:00:00Z`).getTime() / 1000);
    }

    const raw = await browseAthleteActivities(Number(req.params.id), {
      page: Number(page),
      perPage: Number(per_page),
      before,
      after,
    });

    const ids = raw.map((a) => a.id);
    const { rows: alreadyImported } = ids.length
      ? await pool.query("SELECT strava_activity_id FROM activities WHERE strava_activity_id = ANY($1)", [ids])
      : { rows: [] };
    const importedSet = new Set(alreadyImported.map((r) => Number(r.strava_activity_id)));

    res.json(
      raw.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        start_date: a.start_date_local?.slice(0, 10),
        distance: a.distance,
        elevation_gain: a.total_elevation_gain,
        already_imported: importedSet.has(a.id),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Import exactly the activities the person selected.
authRouter.post("/athletes/:id/import", async (req, res) => {
  try {
    const { activityIds } = req.body;
    if (!Array.isArray(activityIds) || !activityIds.length) {
      return res.status(400).json({ error: "activityIds (array) required" });
    }
    let imported = 0;
    for (const stravaId of activityIds) {
      await importStravaActivity(Number(req.params.id), stravaId);
      imported++;
    }
    res.json({ imported });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
