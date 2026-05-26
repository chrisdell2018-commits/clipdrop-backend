const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ─── Test connection ───────────────────────────────────────────────
pool.query("SELECT NOW()", (err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected");
  }
});

// ─── Schema ────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- Users (your app's accounts)
  CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    name        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Connected platform accounts (OAuth tokens per user)
  CREATE TABLE IF NOT EXISTS platform_accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,            -- youtube | tiktok | instagram | facebook
    platform_user_id TEXT,
    platform_username TEXT,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    token_expires_at TIMESTAMPTZ,
    connected_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform)
  );

  -- Uploaded videos (original files)
  CREATE TABLE IF NOT EXISTS videos (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    tags          TEXT[],
    original_key  TEXT NOT NULL,             -- S3 key for original file
    duration_sec  INTEGER,
    file_size     BIGINT,
    mime_type     TEXT,
    status        TEXT DEFAULT 'uploaded',   -- uploaded | processing | ready | failed
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- Clips (segments cut from the original)
  CREATE TABLE IF NOT EXISTS clips (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id      UUID REFERENCES videos(id) ON DELETE CASCADE,
    clip_index    INTEGER NOT NULL,
    start_sec     INTEGER NOT NULL,
    end_sec       INTEGER NOT NULL,
    format        TEXT NOT NULL,             -- 9:16 | 16:9 | 1:1
    s3_key        TEXT,
    status        TEXT DEFAULT 'pending',    -- pending | processing | ready | failed
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- Publish jobs (one row per platform per video)
  CREATE TABLE IF NOT EXISTS publish_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    platform        TEXT NOT NULL,
    status          TEXT DEFAULT 'queued',   -- queued | processing | done | failed
    clips_total     INTEGER DEFAULT 0,
    clips_done      INTEGER DEFAULT 0,
    error_message   TEXT,
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- Individual clip upload results
  CREATE TABLE IF NOT EXISTS publish_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publish_job_id  UUID REFERENCES publish_jobs(id) ON DELETE CASCADE,
    clip_id         UUID REFERENCES clips(id),
    platform_url    TEXT,
    platform_post_id TEXT,
    status          TEXT DEFAULT 'pending',  -- pending | done | failed
    error_message   TEXT,
    published_at    TIMESTAMPTZ
  );
`;

async function initDB() {
  try {
    await pool.query(SCHEMA);
    console.log("✅ Database schema ready");
  } catch (err) {
    console.error("❌ Schema init failed:", err.message);
  }
}

initDB();

module.exports = pool;
