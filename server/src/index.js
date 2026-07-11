import "dotenv/config";
import express from "express";
import cors from "cors";
import { initSchema } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { activitiesRouter } from "./routes/activities.js";
import { gpxRouter } from "./routes/gpx.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/activities", activitiesRouter);
app.use("/api/gpx", gpxRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`EMC Activities server listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database schema", err);
    process.exit(1);
  });
