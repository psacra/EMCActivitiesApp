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

// Lists an athlete's Strava activities WITHOUT importing them, so the person
// can pick which ones to bring into the log. Supports paging back through
// any year via before/after (unix seconds).
export async function browseAthleteActivities(athleteId, { page = 1, perPage = 30, before, after } = {}) {
  const { rows } = await pool.query("SELECT * FROM athletes WHERE id = $1", [athleteId]);
  const athlete = rows[0];
  if (!athlete) throw new Error("Athlete not found");

  const accessToken = await refreshTokenIfNeeded(athlete);

  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (before) params.set("before", String(before));
  if (after) params.set("after", String(after));

  const res = await fetch(`${STRAVA_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
  return res.json();
}

// Imports exactly one Strava activity, chosen by the person, by id.
export async function importStravaActivity(athleteId, stravaActivityId) {
  const { rows } = await pool.query("SELECT * FROM athletes WHERE id = $1", [athleteId]);
  const athlete = rows[0];
  if (!athlete) throw new Error("Athlete not found");

  const accessToken = await refreshTokenIfNeeded(athlete);

  const res = await fetch(`${STRAVA_BASE}/activities/${stravaActivityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status}`);
  const a = await res.json();

  await pool.query(
    `INSERT INTO activities
      (source, strava_activity_id, athlete_id, name, activity_type, start_date,
       distance_m, elevation_gain_m, moving_time_s, summary_polyline, description)
     VALUES ('strava', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (strava_activity_id) DO UPDATE SET
       name = EXCLUDED.name,
       distance_m = EXCLUDED.distance_m,
       elevation_gain_m = EXCLUDED.elevation_gain_m,
       moving_time_s = EXCLUDED.moving_time_s,
       summary_polyline = EXCLUDED.summary_polyline,
       description = COALESCE(activities.description, EXCLUDED.description),
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
      a.map?.summary_polyline || a.map?.polyline || null,
      a.description || null,
    ]
  );
  return a;
}

function mapType(stravaType) {
  if (["MountainBikeRide"].includes(stravaType)) return "mtb";
  if (["Ride", "GravelRide"].includes(stravaType)) return "ride";
  if (["Hike", "Walk"].includes(stravaType)) return "hike";
  if (["TrailRun", "Run"].includes(stravaType)) return "run";
  return "other";
}
