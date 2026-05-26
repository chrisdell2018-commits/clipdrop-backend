const express = require("express");
const { upload } = require("../middleware/upload");
const { getVideoInfo } = require("../services/ffmpeg");
const { addVideoJob } = require("../services/queue");
const db = require("../utils/db");

const router = express.Router();

// ─── POST /api/upload  ─────────────────────────────────────────────────────────
// Accepts video file, saves it, kicks off processing job
router.post("/", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file provided" });
  }

  const {
    title, description, tags,
    platforms,         // JSON: { youtube: true, tiktok: true, ... }
    clipLength,        // seconds, e.g. 60
    cropStyle,         // "auto" | "center" | "manual"
    captions,          // "true" | "false"
    autoPublish,       // "true" | "false"
    scheduledAt,       // ISO date string or null
  } = req.body;

  // Parse platforms JSON
  let parsedPlatforms;
  try {
    parsedPlatforms = typeof platforms === "string" ? JSON.parse(platforms) : platforms;
  } catch {
    parsedPlatforms = { youtube: true, tiktok: true, instagram: true, facebook: true };
  }

  // Save upload record to DB
  const result = await db.query(
    `INSERT INTO uploads (user_id, original_name, file_path, file_size, title, description, tags, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded', $8) RETURNING *`,
    [
      req.user.userId,
      req.file.originalname,
      req.file.path,
      req.file.size,
      title || req.file.originalname,
      description || null,
      tags || null,
      scheduledAt || null,
    ]
  );

  const upload_record = result.rows[0];

  // Queue the video processing job
  const job = await addVideoJob({
    uploadId: upload_record.id,
    userId: req.user.userId,
    filePath: req.file.path,
    platforms: parsedPlatforms,
    options: {
      clipLength: parseInt(clipLength) || 60,
      cropStyle: cropStyle || "center",
      captions: captions === "true",
      autoPublish: autoPublish === "true",
      scheduledAt: scheduledAt || null,
    },
  });

  res.status(202).json({
    message: "Video uploaded successfully. Processing has started.",
    uploadId: upload_record.id,
    jobId: job.id,
    file: {
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
    },
  });
});

// ─── GET /api/upload  ─── List user's uploads ─────────────────────────────────
router.get("/", async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const result = await db.query(
    `SELECT u.*, 
       COUNT(c.id) AS total_clips,
       COUNT(c.id) FILTER (WHERE c.status = 'published') AS published_clips
     FROM uploads u
     LEFT JOIN clips c ON c.upload_id = u.id
     WHERE u.user_id = $1
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.userId, limit, offset]
  );

  const countResult = await db.query(
    "SELECT COUNT(*) FROM uploads WHERE user_id = $1",
    [req.user.userId]
  );

  res.json({
    uploads: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
});

// ─── GET /api/upload/:id  ─── Single upload with clips ────────────────────────
router.get("/:id", async (req, res) => {
  const uploadResult = await db.query(
    "SELECT * FROM uploads WHERE id = $1 AND user_id = $2",
    [req.params.id, req.user.userId]
  );

  if (!uploadResult.rows[0]) {
    return res.status(404).json({ error: "Upload not found" });
  }

  const clipsResult = await db.query(
    "SELECT * FROM clips WHERE upload_id = $1 ORDER BY platform, clip_index",
    [req.params.id]
  );

  // Group clips by platform
  const clipsByPlatform = clipsResult.rows.reduce((acc, clip) => {
    if (!acc[clip.platform]) acc[clip.platform] = [];
    acc[clip.platform].push(clip);
    return acc;
  }, {});

  res.json({ upload: uploadResult.rows[0], clips: clipsByPlatform });
});

// ─── DELETE /api/upload/:id ────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const result = await db.query(
    "DELETE FROM uploads WHERE id = $1 AND user_id = $2 RETURNING id",
    [req.params.id, req.user.userId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "Upload not found" });
  }

  res.json({ message: "Upload deleted", id: req.params.id });
});

module.exports = router;
