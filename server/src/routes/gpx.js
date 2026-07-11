import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import GPXParser from "gpxparser";
import { pool } from "../db.js";

export const gpxRouter = Router();

const UPLOAD_DIR = process.env.GPX_UPLOAD_DIR || "./uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

// Upload one GPX file -> creates a new activity record from its track data.
gpxRouter.post("/", upload.single("gpx"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const xml = fs.readFileSync(req.file.path, "utf8");
    const gpx = new GPXParser();
    gpx.parse(xml);

    const track = gpx.tracks[0];
    if (!track) return res.status(400).json({ error: "GPX file has no track data" });

    const distance_m = track.distance?.total || 0;
    const elevation_gain_m = track.elevation?.pos || 0;
    const points = track.points || [];
    const startDate = points[0]?.time ? points[0].time.toISOString().slice(0, 10) : null;

    const name = req.body.name || track.name || path.basename(req.file.originalname, ".gpx");
    const activity_type = req.body.activity_type || "hike";

    const finalPath = path.join(UPLOAD_DIR, `${Date.now()}-${req.file.originalname}`);
    fs.renameSync(req.file.path, finalPath);

    const { rows } = await pool.query(
      `INSERT INTO activities (source, name, activity_type, start_date, distance_m, elevation_gain_m, gpx_path)
       VALUES ('gpx', $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, activity_type, startDate, distance_m, elevation_gain_m, finalPath]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serve back the raw GPX so the frontend can draw it on a Leaflet/OSM map.
gpxRouter.get("/:id/file", async (req, res) => {
  const { rows } = await pool.query("SELECT gpx_path FROM activities WHERE id = $1", [req.params.id]);
  if (!rows[0]?.gpx_path) return res.status(404).json({ error: "No GPX file for this activity" });
  res.sendFile(path.resolve(rows[0].gpx_path));
});
