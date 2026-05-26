const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const PROCESSED_DIR = process.env.PROCESSED_DIR || "./processed";

// Ensure processed dir exists
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// ─── Get video metadata (duration, resolution, etc.) ─────────────────────────
const getVideoInfo = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const stream = metadata.streams.find(s => s.codec_type === "video");
      resolve({
        duration: metadata.format.duration,
        size: metadata.format.size,
        width: stream?.width,
        height: stream?.height,
        fps: stream?.r_frame_rate,
        codec: stream?.codec_name,
        bitrate: metadata.format.bit_rate,
      });
    });
  });
};

// ─── Platform configs ─────────────────────────────────────────────────────────
const PLATFORM_CONFIGS = {
  youtube: {
    format: "16:9",
    width: 1920,
    height: 1080,
    maxDuration: null, // full video
    codec: "libx264",
    audioBitrate: "192k",
    videoBitrate: "8000k",
  },
  tiktok: {
    format: "9:16",
    width: 1080,
    height: 1920,
    maxDuration: 60,
    codec: "libx264",
    audioBitrate: "128k",
    videoBitrate: "4000k",
  },
  instagram: {
    format: "9:16",
    width: 1080,
    height: 1920,
    maxDuration: 90,
    codec: "libx264",
    audioBitrate: "128k",
    videoBitrate: "4000k",
  },
  facebook: {
    format: "16:9",
    width: 1280,
    height: 720,
    maxDuration: 60,
    codec: "libx264",
    audioBitrate: "128k",
    videoBitrate: "4000k",
  },
};

// ─── Build crop/scale filter for vertical (9:16) platforms ───────────────────
const buildVideoFilter = (config, cropStyle = "center") => {
  const { width, height, format } = config;

  if (format === "9:16") {
    // Convert landscape to portrait
    if (cropStyle === "auto") {
      // Face-tracking crop (simplified: center-weighted crop for MVP)
      // In production: integrate with a face-detection service
      return `scale=${width * 2}:${height},crop=${width}:${height}:(ow-${width})/2:(oh-${height})/2`;
    }
    // Center crop
    return `scale=-2:${height},crop=${width}:${height}`;
  }

  // 16:9 — standard scale
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
};

// ─── Split a video into clips ──────────────────────────────────────────────────
const splitVideo = (inputPath, platform, options = {}) => {
  return new Promise(async (resolve, reject) => {
    const config = PLATFORM_CONFIGS[platform];
    if (!config) return reject(new Error(`Unknown platform: ${platform}`));

    const { duration, cropStyle = "center", addCaptions = false, onProgress } = options;

    // Get video duration if not provided
    let videoDuration = duration;
    if (!videoDuration) {
      const info = await getVideoInfo(inputPath);
      videoDuration = info.duration;
    }

    const clips = [];
    const jobDir = path.join(PROCESSED_DIR, uuidv4());
    fs.mkdirSync(jobDir, { recursive: true });

    // For YouTube — just reformat, don't split
    if (platform === "youtube") {
      const outputPath = path.join(jobDir, `youtube_full.mp4`);
      await reformatVideo(inputPath, outputPath, config, cropStyle);
      clips.push({ index: 0, path: outputPath, startTime: 0, duration: videoDuration, platform });
      return resolve({ clips, jobDir });
    }

    // For short-form — split into chunks
    const clipDuration = config.maxDuration;
    const totalClips = Math.ceil(videoDuration / clipDuration);
    const videoFilter = buildVideoFilter(config, cropStyle);

    let completed = 0;

    const processClip = (index) => {
      return new Promise((res, rej) => {
        const startTime = index * clipDuration;
        const outputPath = path.join(jobDir, `${platform}_clip_${String(index + 1).padStart(3, "0")}.mp4`);

        let cmd = ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(clipDuration)
          .videoFilters(videoFilter)
          .videoCodec(config.codec)
          .videoBitrate(config.videoBitrate)
          .audioCodec("aac")
          .audioBitrate(config.audioBitrate)
          .outputOptions([
            "-movflags +faststart", // web-optimized
            "-preset fast",
            "-crf 23",
          ]);

        // Add burned-in captions (requires SRT file — MVP placeholder)
        if (addCaptions) {
          // In production: generate SRT with Whisper API, then:
          // cmd = cmd.videoFilters(`subtitles=${srtPath}`);
          console.log(`[FFmpeg] Captions requested for clip ${index + 1} — integrate Whisper API for production`);
        }

        cmd
          .output(outputPath)
          .on("progress", (progress) => {
            if (onProgress) onProgress({ clip: index + 1, totalClips, progress });
          })
          .on("end", () => {
            completed++;
            clips.push({ index, path: outputPath, startTime, duration: clipDuration, platform });
            res();
          })
          .on("error", (err) => {
            console.error(`[FFmpeg] Error on clip ${index + 1}:`, err.message);
            rej(err);
          })
          .run();
      });
    };

    // Process clips in batches of 3 (avoid overloading CPU)
    const BATCH_SIZE = 3;
    for (let i = 0; i < totalClips; i += BATCH_SIZE) {
      const batch = Array.from(
        { length: Math.min(BATCH_SIZE, totalClips - i) },
        (_, j) => processClip(i + j)
      );
      await Promise.all(batch);
    }

    resolve({ clips: clips.sort((a, b) => a.index - b.index), jobDir });
  });
};

// ─── Reformat (no split) for YouTube ─────────────────────────────────────────
const reformatVideo = (inputPath, outputPath, config, cropStyle) => {
  return new Promise((resolve, reject) => {
    const videoFilter = buildVideoFilter(config, cropStyle);

    ffmpeg(inputPath)
      .videoFilters(videoFilter)
      .videoCodec(config.codec)
      .videoBitrate(config.videoBitrate)
      .audioCodec("aac")
      .audioBitrate(config.audioBitrate)
      .outputOptions(["-movflags +faststart", "-preset fast", "-crf 23"])
      .output(outputPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
};

// ─── Clean up temp files after upload ────────────────────────────────────────
const cleanupFiles = (filePaths) => {
  filePaths.forEach((fp) => {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      console.log(`[Cleanup] Deleted: ${fp}`);
    }
  });
};

const cleanupDir = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`[Cleanup] Deleted dir: ${dirPath}`);
  }
};

module.exports = {
  getVideoInfo,
  splitVideo,
  cleanupFiles,
  cleanupDir,
  PLATFORM_CONFIGS,
};
