import { Router } from "express";
import { pool } from "../db.js";
import { getAuthorizeUrl, exchangeCodeForToken, syncAthleteActivities } from "../strava.js";

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

    // Kick off an initial sync right away so new members see their history.
    await syncAthleteActivities(athlete.id);

    res.redirect(`${process.env.PUBLIC_CLIENT_URL}/?connected=${athlete.firstname}`);
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

authRouter.post("/athletes/:id/sync", async (req, res) => {
  try {
    const result = await syncAthleteActivities(Number(req.params.id));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
