require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const authRoutes = require("./routes/auth");
const videoRoutes = require("./routes/video");
const publishRoutes = require("./routes/publish");
const jobRoutes = require("./routes/jobs");
const { errorHandler } = require("./middleware/errorHandler");
const { requireAuth } = require("./middleware/auth");

// ─── Boot queue workers ────────────────────────────────────────────
require("./jobs/videoProcessor");
require("./jobs/publisher");

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health check ──────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// ─── Routes ────────────────────────────────────────────────────────
app.use("/auth", authRoutes);                    // login, register, OAuth
app.use("/video", requireAuth, videoRoutes);     // upload & process
app.use("/publish", requireAuth, publishRoutes); // send to platforms
app.use("/jobs", requireAuth, jobRoutes);        // job status polling

// ─── Error handler (always last) ──────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 ClipDrop backend running on http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
