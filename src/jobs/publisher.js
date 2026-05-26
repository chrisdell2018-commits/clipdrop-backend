const { publishingQueue } = require("../services/queue");
const db = require("../utils/db");
const fs = require("fs");

// ─── Helper: get platform token for user ─────────────────────────────────────
const getToken = async (userId, platform) => {
  const result = await db.query(
    "SELECT * FROM platform_tokens WHERE user_id = $1 AND platform = $2",
    [userId, platform]
  );
  return result.rows[0] || null;
};

// ─── Helper: log publish event ────────────────────────────────────────────────
const logEvent = async (uploadId, clipId, platform, event, message) => {
  await db.query(
    "INSERT INTO publish_logs (upload_id, clip_id, platform, event, message) VALUES ($1,$2,$3,$4,$5)",
    [uploadId, clipId || null, platform, event, message]
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE UPLOADER
// ─────────────────────────────────────────────────────────────────────────────
const publishToYouTube = async (clip, upload, token) => {
  const { google } = require("googleapis");

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ access_token: token.access_token, refresh_token: token.refresh_token });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: upload.title || "ClipDrop Upload",
        description: upload.description || "",
        tags: upload.tags ? upload.tags.split(",").map(t => t.trim()) : [],
        categoryId: "22", // People & Blogs
      },
      status: { privacyStatus: "public" },
    },
    media: {
      body: fs.createReadStream(clip.file_path),
    },
  });

  return { videoId: res.data.id, url: `https://www.youtube.com/watch?v=${res.data.id}` };
};

// ─────────────────────────────────────────────────────────────────────────────
// TIKTOK UPLOADER
// ─────────────────────────────────────────────────────────────────────────────
const publishToTikTok = async (clip, upload, token) => {
  // Step 1: Initialize upload
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: upload.title || "ClipDrop",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fs.statSync(clip.file_path).size,
        chunk_size: fs.statSync(clip.file_path).size,
        total_chunk_count: 1,
      },
    }),
  });

  const initData = await initRes.json();
  if (initData.error?.code !== "ok") throw new Error(`TikTok init failed: ${initData.error?.message}`);

  const { publish_id, upload_url } = initData.data;

  // Step 2: Upload video binary
  const fileBuffer = fs.readFileSync(clip.file_path);
  await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${fileBuffer.length - 1}/${fileBuffer.length}`,
    },
    body: fileBuffer,
  });

  return { videoId: publish_id, url: `https://www.tiktok.com/@${token.platform_username}` };
};

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM UPLOADER (Reels via Graph API)
// ─────────────────────────────────────────────────────────────────────────────
const publishToInstagram = async (clip, upload, token) => {
  const igAccountRes = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?access_token=${token.access_token}`
  );
  const igAccountData = await igAccountRes.json();
  const page = igAccountData.data?.[0];
  if (!page) throw new Error("No Instagram Business account found");

  const igRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${token.access_token}`);
  const igData = await igRes.json();
  const igUserId = igData.instagram_business_account?.id;
  if (!igUserId) throw new Error("No Instagram account linked to page");

  // Note: In production, you need a publicly accessible video URL (upload to S3 first)
  const videoUrl = `${process.env.BACKEND_URL}/clips/${clip.file_path.split("/").pop()}`;

  // Step 1: Create media container
  const containerRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_url: videoUrl,
      media_type: "REELS",
      caption: upload.title || "",
      access_token: token.access_token,
    }),
  });
  const containerData = await containerRes.json();
  if (containerData.error) throw new Error(containerData.error.message);

  // Step 2: Publish
  const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerData.id, access_token: token.access_token }),
  });
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error(publishData.error.message);

  return { videoId: publishData.id, url: `https://www.instagram.com/p/${publishData.id}` };
};

// ─────────────────────────────────────────────────────────────────────────────
// FACEBOOK UPLOADER
// ─────────────────────────────────────────────────────────────────────────────
const publishToFacebook = async (clip, upload, token) => {
  const pageRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${token.access_token}`);
  const pageData = await pageRes.json();
  const page = pageData.data?.[0];
  if (!page) throw new Error("No Facebook page found");

  const videoUrl = `${process.env.BACKEND_URL}/clips/${clip.file_path.split("/").pop()}`;

  const res = await fetch(`https://graph.facebook.com/v18.0/${page.id}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: videoUrl,
      title: upload.title || "",
      description: upload.description || "",
      access_token: page.access_token,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  return { videoId: data.id, url: `https://www.facebook.com/watch?v=${data.id}` };
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PUBLISH WORKER
// ─────────────────────────────────────────────────────────────────────────────
publishingQueue.process(async (job) => {
  const { uploadId, platform, userId } = job.data;
  console.log(`[Publisher] Publishing ${platform} for upload ${uploadId}`);

  const uploadResult = await db.query("SELECT * FROM uploads WHERE id=$1", [uploadId]);
  const upload = uploadResult.rows[0];
  if (!upload) throw new Error("Upload not found");

  const token = await getToken(userId, platform);
  if (!token) throw new Error(`No ${platform} account connected`);

  const clipsResult = await db.query(
    "SELECT * FROM clips WHERE upload_id=$1 AND platform=$2 AND status='ready' ORDER BY clip_index",
    [uploadId, platform]
  );
  const clips = clipsResult.rows;
  if (!clips.length) throw new Error(`No ready clips found for ${platform}`);

  await logEvent(uploadId, null, platform, "started", `Publishing ${clips.length} clips to ${platform}`);

  const publishers = { youtube: publishToYouTube, tiktok: publishToTikTok, instagram: publishToInstagram, facebook: publishToFacebook };
  const publishFn = publishers[platform];
  if (!publishFn) throw new Error(`No publisher for platform: ${platform}`);

  let published = 0;
  for (const clip of clips) {
    try {
      await db.query("UPDATE clips SET status='uploading', updated_at=NOW() WHERE id=$1", [clip.id]);

      const result = await publishFn(clip, upload, token);

      await db.query(
        "UPDATE clips SET status='published', platform_video_id=$1, platform_video_url=$2, published_at=NOW(), updated_at=NOW() WHERE id=$3",
        [result.videoId, result.url, clip.id]
      );

      await logEvent(uploadId, clip.id, platform, "succeeded", `Clip ${clip.clip_index + 1} published: ${result.url}`);
      published++;
      await job.progress(Math.round((published / clips.length) * 100));

    } catch (err) {
      console.error(`[Publisher] Clip ${clip.id} failed:`, err.message);
      await db.query("UPDATE clips SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2", [err.message, clip.id]);
      await logEvent(uploadId, clip.id, platform, "failed", err.message);
    }
  }

  console.log(`[Publisher] ${platform}: ${published}/${clips.length} clips published`);
  return { platform, published, total: clips.length };
});

console.log("[Publisher] Publishing worker started");
