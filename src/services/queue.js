const Bull = require("bull");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ─── Job Queues ───────────────────────────────────────────────────────────────
const videoProcessingQueue = new Bull("video-processing", REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 50,  // keep last 50 completed
    removeOnFail: 100,     // keep last 100 failed for debugging
  },
});

const publishingQueue = new Bull("publishing", REDIS_URL, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

// ─── Queue event logging ──────────────────────────────────────────────────────
videoProcessingQueue.on("completed", (job) => {
  console.log(`[Queue] Video processing job ${job.id} completed`);
});
videoProcessingQueue.on("failed", (job, err) => {
  console.error(`[Queue] Video processing job ${job.id} failed:`, err.message);
});
videoProcessingQueue.on("progress", (job, progress) => {
  console.log(`[Queue] Job ${job.id} progress: ${progress}%`);
});

publishingQueue.on("completed", (job) => {
  console.log(`[Queue] Publishing job ${job.id} completed`);
});
publishingQueue.on("failed", (job, err) => {
  console.error(`[Queue] Publishing job ${job.id} failed:`, err.message);
});

// ─── Add a video processing job ──────────────────────────────────────────────
const addVideoJob = async (data) => {
  const job = await videoProcessingQueue.add(data, { priority: 1 });
  console.log(`[Queue] Added video processing job ${job.id} for upload ${data.uploadId}`);
  return job;
};

// ─── Add a publishing job ─────────────────────────────────────────────────────
const addPublishJob = async (data) => {
  const job = await publishingQueue.add(data, { priority: 2 });
  console.log(`[Queue] Added publish job ${job.id} for ${data.platform}`);
  return job;
};

// ─── Get job status ────────────────────────────────────────────────────────────
const getJobStatus = async (jobId, queue = "video") => {
  const q = queue === "video" ? videoProcessingQueue : publishingQueue;
  const job = await q.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id,
    state,
    progress: job.progress(),
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
    createdAt: new Date(job.timestamp),
    processedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
  };
};

module.exports = {
  videoProcessingQueue,
  publishingQueue,
  addVideoJob,
  addPublishJob,
  getJobStatus,
};
