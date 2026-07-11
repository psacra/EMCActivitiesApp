import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS athletes (
  id BIGINT PRIMARY KEY,              -- Strava athlete id
  first_name TEXT,
  last_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at BIGINT,
  connected_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('strava', 'gpx')),
  strava_activity_id BIGINT UNIQUE,
  athlete_id BIGINT REFERENCES athletes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'hike', -- hike | mtb | ride | run | other
  start_date DATE,
  distance_m NUMERIC,
  elevation_gain_m NUMERIC,
  moving_time_s INTEGER,
  summary_polyline TEXT,               -- encoded polyline for map preview
  gpx_path TEXT,                        -- stored file path if source = gpx
  description TEXT,
  participants TEXT[],                  -- free-text list of who took part
  tags TEXT[] DEFAULT '{}',
  is_curated BOOLEAN DEFAULT false,     -- approved/curated for public list
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_tags ON activities USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_activities_curated ON activities(is_curated);
`;

export async function initSchema() {
  await pool.query(SCHEMA);
}
