// ─── ClipDrop Worker Process ──────────────────────────────────────────────────
// Run this as a SEPARATE process from the API server:
//   node src/worker.js
//
// In production, run multiple instances for parallelism:
//   pm2 start src/worker.js -i 2

require("dotenv").config();
require("./jobs/videoProcessor");
require("./jobs/publisher");

console.log("🔧 ClipDrop worker running — processing video and publishing jobs...");

process.on("SIGTERM", async () => {
  console.log("Worker shutting down gracefully...");
  process.exit(0);
});
