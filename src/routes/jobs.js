const express = require("express");
const { getJobStatus } = require("../services/queue");
const db = require("../utils/db");

const router = express.Router();

// ─── GET /api/jobs/:jobId  ─── Check processing job status ───────────────────
router.get("/:jobId", async (req, res) => {
  const status = await getJobStatus(req.params.jobId, "video");
  if (!status) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(status);
});

// ─── GET /api/jobs/upload/:uploadId  ─── Get all jobs for an upload ───────────
router.get("/upload/:uploadId", async (req, res) => {
  // Verify the upload belongs to this user
  const upload = await db.query(
    "SELECT id, status, error_message FROM uploads WHERE id = $1 AND user_id = $2",
    [req.params.uploadId, req.user.userId]
  );

  if (!upload.rows[0]) {
    return res.status(404).json({ error: "Upload not found" });
  }

  const clips = await db.query(
    `SELECT platform, 
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status='published') AS published,
       COUNT(*) FILTER (WHERE status='failed') AS failed,
       COUNT(*) FILTER (WHERE status='ready') AS ready,
       COUNT(*) FILTER (WHERE status='uploading') AS uploading
     FROM clips WHERE upload_id = $1 GROUP BY platform`,
    [req.params.uploadId]
  );

  res.json({
    upload: upload.rows[0],
    platforms: clips.rows,
  });
});

module.exports = router;
