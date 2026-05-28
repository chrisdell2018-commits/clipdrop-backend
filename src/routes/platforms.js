const express = require("express");
const db = require("../utils/db");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

// ─── GET /api/platforms  ─── Get user's connected platforms ──────────────────
router.get("/",  authMiddleware, async (req, res) => {
  const result = await db.query(
    `SELECT platform, platform_username, platform_user_id, token_expires, created_at
     FROM platform_tokens WHERE user_id = $1`,
    [req.user.userId]
  );

  const connected = result.rows.reduce((acc, row) => {
    acc[row.platform] = {
      connected: true,
      username: row.platform_username,
      platformUserId: row.platform_user_id,
      tokenExpires: row.token_expires,
      connectedAt: row.created_at,
    };
    return acc;
  }, {});

  res.json({ platforms: connected });
});

// ─── DELETE /api/platforms/:platform  ─── Disconnect a platform ──────────────
router.delete("/:platform", authMiddleware, async (req, res) => {
  const { platform } = req.params;
  await db.query(
    "DELETE FROM platform_tokens WHERE user_id = $1 AND platform = $2",
    [req.user.userId, platform]
  );
  res.json({ message: `${platform} disconnected successfully` });
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth flows — each platform has: /connect (redirect) + /callback (receive token)
// These are stubs. Wire up real OAuth in the next step.
// ─────────────────────────────────────────────────────────────────────────────

// ── YOUTUBE ──────────────────────────────────────────────────────────────────
router.get("/youtube/connect", authMiddleware, (req, res) => {
  const { google } = require("googleapis");
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
  const scopes = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: req.user.userId, // pass userId through OAuth state param
    prompt: "consent",
  });
  res.json({ redirectUrl: url });
});

router.get("/youtube/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).json({ error: "No code received" });
  if (!userId) return res.redirect(`${process.env.FRONTEND_URL}?error=missing_state`);

  const { google } = require("googleapis");
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get YouTube channel info
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const channelRes = await youtube.channels.list({ part: "snippet", mine: true });
  const channel = channelRes.data.items?.[0];

  await db.query(
    `INSERT INTO platform_tokens (user_id, platform, access_token, refresh_token, token_expires, platform_user_id, platform_username)
     VALUES ($1, 'youtube', $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, platform) DO UPDATE
     SET access_token=$2, refresh_token=$3, token_expires=$4, platform_user_id=$5, platform_username=$6, updated_at=NOW()`,
    [userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date ? new Date(tokens.expiry_date) : null, channel?.id, channel?.snippet?.title]
  );

  res.redirect(`${process.env.FRONTEND_URL}?platform=youtube&connected=true`);
});

// ── TIKTOK ───────────────────────────────────────────────────────────────────
router.get("/tiktok/connect", authMiddleware, (req, res) => {
  const scope = "user.info.basic,video.upload,video.publish";
  const url = `https://www.tiktok.com/v2/auth/authorize/`
    + `?client_key=${process.env.TIKTOK_CLIENT_ID}`
    + `&scope=${scope}`
    + `&response_type=code`
    + `&redirect_uri=${encodeURIComponent(process.env.TIKTOK_REDIRECT_URI)}`
    + `&state=${req.user.userId}`;
  res.json({ redirectUrl: url });
});

router.get("/tiktok/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).json({ error: "No code received" });

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code, grant_type: "authorization_code",
      redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) return res.status(400).json({ error: tokenData.error_description });

  await db.query(
    `INSERT INTO platform_tokens (user_id, platform, access_token, refresh_token, token_expires, platform_user_id)
     VALUES ($1, 'tiktok', $2, $3, $4, $5)
     ON CONFLICT (user_id, platform) DO UPDATE
     SET access_token=$2, refresh_token=$3, token_expires=$4, updated_at=NOW()`,
    [userId, tokenData.access_token, tokenData.refresh_token, new Date(Date.now() + tokenData.expires_in * 1000), tokenData.open_id]
  );

  res.redirect(`${process.env.FRONTEND_URL}?platform=tiktok&connected=true`);
});

// ── META (Instagram + Facebook) ───────────────────────────────────────────────
router.get("/meta/connect",  authMiddleware, (req, res) => {
  const scope = "pages_manage_posts,instagram_basic,instagram_content_publish,pages_read_engagement";
  const url = `https://www.facebook.com/v18.0/dialog/oauth`
    + `?client_id=${process.env.META_APP_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}`
    + `&scope=${scope}`
    + `&state=${req.user.userId}`;
  res.json({ redirectUrl: url });
});

router.get("/meta/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).json({ error: "No code received" });

  const tokenRes = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token`
    + `?client_id=${process.env.META_APP_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.META_REDIRECT_URI)}`
    + `&client_secret=${process.env.META_APP_SECRET}`
    + `&code=${code}`
  );
  const tokenData = await tokenRes.json();
  if (tokenData.error) return res.status(400).json({ error: tokenData.error.message });

  // Get user info
  const userRes = await fetch(`https://graph.facebook.com/me?access_token=${tokenData.access_token}&fields=id,name`);
  const userData = await userRes.json();

  // Save for both instagram and facebook (same token)
  for (const platform of ["instagram", "facebook"]) {
    await db.query(
      `INSERT INTO platform_tokens (user_id, platform, access_token, platform_user_id, platform_username)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, platform) DO UPDATE
       SET access_token=$3, platform_user_id=$4, platform_username=$5, updated_at=NOW()`,
      [userId, platform, tokenData.access_token, userData.id, userData.name]
    );
  }

  res.redirect(`${process.env.FRONTEND_URL}?platform=meta&connected=true`);
});

// ─── POST /api/platforms/publish  ─── Manually trigger publish for an upload ──
router.post("/publish",  authMiddleware, async (req, res) => {
  const { uploadId, platforms } = req.body;

  if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

  // Verify upload belongs to user and is ready
  const upload = await db.query(
    "SELECT * FROM uploads WHERE id = $1 AND user_id = $2",
    [uploadId, req.user.userId]
  );

  if (!upload.rows[0]) return res.status(404).json({ error: "Upload not found" });
  if (upload.rows[0].status !== "ready") {
    return res.status(400).json({ error: `Upload is not ready. Current status: ${upload.rows[0].status}` });
  }

  const { publishingQueue } = require("../services/queue");
  const platformList = platforms || ["youtube", "tiktok", "instagram", "facebook"];
  const jobs = [];

  for (const platform of platformList) {
    const job = await publishingQueue.add({
      uploadId,
      platform,
      userId: req.user.userId,
    });
    jobs.push({ platform, jobId: job.id });
  }

  await db.query("UPDATE uploads SET status='publishing', updated_at=NOW() WHERE id=$1", [uploadId]);

  res.json({ message: "Publishing started", jobs });
});

module.exports = router;
