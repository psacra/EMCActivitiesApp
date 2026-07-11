import fetch from "node-fetch";
import { pool } from "./db.js";

const STRAVA_BASE = "https://www.strava.com/api/v3";

export function getAuthorizeUrl(redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status}`);
  return res.json();
}

async function refreshTokenIfNeeded(athlete) {
  const now = Math.floor(Date.now() / 1000);
  if (athlete.token_expires_at > now + 60) return athlete.access_token;

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: athlete.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
  const data = await res.json();

  await pool.query(
    `UPDATE athletes SET access_token = $1, refresh_token = $2, token_expires_at = $3 WHERE id = $4`,
    [data.access_token, data.refresh_token, data.expires_at, athlete.id]
  );
  return data.access_token;
}

// Pulls recent activities for one connected athlete and upserts hikes/rides.
export async function syncAthleteActivities(athleteId, { after } = {}) {
  const { rows } = await pool.query("SELECT * FROM athletes WHERE id = $1", [athleteId]);
  const athlete = rows[0];
  if (!athlete) throw new Error("Athlete not found");

  const accessToken = await refreshTokenIfNeeded(athlete);

  const params = new URLSearchParams({ per_page: "100" });
  if (after) params.set("after", String(Math.floor(new Date(after).getTime() / 1000)));

  const res = await fetch(`${STRAVA_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
  const activities = await res.json();

  // Only bring in hike / MTB / ride-type activities; everything else is skipped.
  const relevant = activities.filter((a) =>
    ["Hike", "Walk", "MountainBikeRide", "Ride", "GravelRide", "TrailRun", "Run"].includes(a.type)
  );

  let imported = 0;
  for (const a of relevant) {
    await pool.query(
      `INSERT INTO activities
        (source, strava_activity_id, athlete_id, name, activity_type, start_date,
         distance_m, elevation_gain_m, moving_time_s, summary_polyline)
       VALUES ('strava', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (strava_activity_id) DO UPDATE SET
         name = EXCLUDED.name,
         distance_m = EXCLUDED.distance_m,
         elevation_gain_m = EXCLUDED.elevation_gain_m,
         moving_time_s = EXCLUDED.moving_time_s,
         summary_polyline = EXCLUDED.summary_polyline,
         updated_at = now()`,
      [
        a.id,
        athlete.id,
        a.name,
        mapType(a.type),
        a.start_date_local?.slice(0, 10),
        a.distance,
        a.total_elevation_gain,
        a.moving_time,
        a.map?.summary_polyline || null,
      ]
    );
    imported++;
  }
  return { imported, totalFetched: activities.length };
}

function mapType(stravaType) {
  if (["MountainBikeRide"].includes(stravaType)) return "mtb";
  if (["Ride", "GravelRide"].includes(stravaType)) return "ride";
  if (["Hike", "Walk"].includes(stravaType)) return "hike";
  if (["TrailRun", "Run"].includes(stravaType)) return "run";
  return "other";
}
