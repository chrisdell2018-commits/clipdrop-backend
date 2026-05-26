const { videoProcessingQueue, publishingQueue } = require("../services/queue");
const { splitVideo, getVideoInfo } = require("../services/ffmpeg");
const db = require("../utils/db");

videoProcessingQueue.process(async (job) => {
  const { uploadId, filePath, platforms, options, userId } = job.data;
  console.log(`[Worker] Starting video processing for upload: ${uploadId}`);

  try {
    await db.query("UPDATE uploads SET status=$1, updated_at=NOW() WHERE id=$2", ["processing", uploadId]);

    await job.progress(5);
    const videoInfo = await getVideoInfo(filePath);

    await db.query(
      "UPDATE uploads SET duration=$1, width=$2, height=$3, updated_at=NOW() WHERE id=$4",
      [videoInfo.duration, videoInfo.width, videoInfo.height, uploadId]
    );

    const platformResults = [];
    const platformList = Object.keys(platforms).filter(p => platforms[p]);
    const progressPerPlatform = 85 / platformList.length;

    for (let i = 0; i < platformList.length; i++) {
      const platform = platformList[i];
      console.log(`[Worker] Processing for ${platform}...`);
      await job.progress(10 + i * progressPerPlatform);

      const { clips, jobDir } = await splitVideo(filePath, platform, {
        duration: videoInfo.duration,
        cropStyle: options.cropStyle || "center",
        addCaptions: options.captions || false,
        onProgress: async ({ clip, totalClips }) => {
          const pct = 10 + i * progressPerPlatform + (clip / totalClips) * progressPerPlatform;
          await job.progress(Math.round(pct));
        },
      });

      for (const clip of clips) {
        await db.query(
          `INSERT INTO clips (upload_id, platform, clip_index, file_path, start_time, duration, status)
           VALUES ($1,$2,$3,$4,$5,$6,'ready')`,
          [uploadId, platform, clip.index, clip.path, clip.startTime, clip.duration]
        );
      }

      platformResults.push({ platform, clipCount: clips.length, jobDir });
    }

    await db.query("UPDATE uploads SET status=$1, updated_at=NOW() WHERE id=$2", ["ready", uploadId]);

    if (options.autoPublish) {
      for (const { platform } of platformResults) {
        await publishingQueue.add({ uploadId, platform, userId, scheduledAt: options.scheduledAt || null });
      }
    }

    await job.progress(100);
    return { uploadId, platforms: platformResults };

  } catch (err) {
    console.error(`[Worker] Failed:`, err.message);
    await db.query("UPDATE uploads SET status=$1, error_message=$2, updated_at=NOW() WHERE id=$3", ["failed", err.message, uploadId]);
    throw err;
  }
});

console.log("[Worker] Video processing worker started");
