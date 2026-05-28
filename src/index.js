require("express-async-errors");
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const { errorHandler } = require("./middleware/errorHandler");
const { authMiddleware } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const uploadRoutes = require("./routes/upload");
const jobRoutes = require("./routes/jobs");
const platformRoutes = require("./routes/platforms");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security & Logging ───────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan("dev"));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static: serve processed clips temporarily ───────────────────────────────
app.use("/clips", express.static(path.join(__dirname, "../processed")));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
});

// ─── Public Routes ────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ─── Protected Routes ────────────────────────────────────────────────────────
app.use("/api/upload", authMiddleware, uploadRoutes);
app.use("/api/jobs", authMiddleware, jobRoutes);
app.use("/api/platforms", platformRoutes);

// ─── Error Handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 ClipDrop backend running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health\n`);
});

module.exports = app;
