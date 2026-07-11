import { Router } from "express";
import { pool } from "../db.js";

export const activitiesRouter = Router();

// Simple shared-secret guard for anything that edits data.
// Set CURATOR_PASSWORD in the environment; members send it as 'x-curator-password' header.
function requireCurator(req, res, next) {
  if (!process.env.CURATOR_PASSWORD) return next(); // no password set -> open editing
  if (req.headers["x-curator-password"] === process.env.CURATOR_PASSWORD) return next();
  return res.status(401).json({ error: "Curator password required" });
}

// List + search + filter
activitiesRouter.get("/", async (req, res) => {
  const { q, type, tag, curatedOnly, from, to } = req.query;
  const clauses = [];
  const values = [];

  if (q) {
    values.push(`%${q}%`);
    clauses.push(`(name ILIKE $${values.length} OR description ILIKE $${values.length})`);
  }
  if (type) {
    values.push(type);
    clauses.push(`activity_type = $${values.length}`);
  }
  if (tag) {
    values.push(tag);
    clauses.push(`$${values.length} = ANY(tags)`);
  }
  if (curatedOnly === "true") {
    clauses.push(`is_curated = true`);
  }
  if (from) {
    values.push(from);
    clauses.push(`start_date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    clauses.push(`start_date <= $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.*, ath.first_name, ath.last_name
     FROM activities a
     LEFT JOIN athletes ath ON ath.id = a.athlete_id
     ${where}
     ORDER BY a.start_date DESC NULLS LAST`,
    values
  );
  res.json(rows);
});

activitiesRouter.get("/tags", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT unnest(tags) AS tag FROM activities ORDER BY tag`
  );
  res.json(rows.map((r) => r.tag));
});

activitiesRouter.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// Curate / edit an activity: tags, description, participants, difficulty, approval
activitiesRouter.patch("/:id", requireCurator, async (req, res) => {
  const { name, description, tags, participants, activity_type, is_curated } = req.body;
  const { rows } = await pool.query(
    `UPDATE activities SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       tags = COALESCE($3, tags),
       participants = COALESCE($4, participants),
       activity_type = COALESCE($5, activity_type),
       is_curated = COALESCE($6, is_curated),
       updated_at = now()
     WHERE id = $7
     RETURNING *`,
    [name, description, tags, participants, activity_type, is_curated, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

activitiesRouter.delete("/:id", requireCurator, async (req, res) => {
  await pool.query("DELETE FROM activities WHERE id = $1", [req.params.id]);
  res.status(204).end();
});
