-- ClipDrop Database Schema
-- Run this once to set up your PostgreSQL database

-- Users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  name        VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Platform OAuth tokens (one row per user per platform)
CREATE TABLE IF NOT EXISTS platform_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        VARCHAR(50) NOT NULL,  -- youtube, tiktok, instagram, facebook
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,
  token_expires   TIMESTAMP,
  platform_user_id VARCHAR(255),         -- their ID on that platform
  platform_username VARCHAR(255),
  scopes          TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Video uploads
CREATE TABLE IF NOT EXISTS uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name   VARCHAR(500) NOT NULL,
  file_path       TEXT NOT NULL,
  file_size       BIGINT,
  duration        FLOAT,
  width           INT,
  height          INT,
  title           VARCHAR(500),
  description     TEXT,
  tags            TEXT,
  status          VARCHAR(50) DEFAULT 'uploaded',
  -- Status flow: uploaded → processing → ready → publishing → done | failed
  error_message   TEXT,
  scheduled_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Individual clips (one per platform per time segment)
CREATE TABLE IF NOT EXISTS clips (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id   UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  platform    VARCHAR(50) NOT NULL,
  clip_index  INT NOT NULL,
  file_path   TEXT NOT NULL,
  start_time  FLOAT,
  duration    FLOAT,
  status      VARCHAR(50) DEFAULT 'ready',
  -- Status: ready → uploading → published | failed
  platform_video_id   VARCHAR(255),  -- ID returned by the platform after upload
  platform_video_url  TEXT,          -- public URL on the platform
  error_message       TEXT,
  published_at        TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- Publish logs (audit trail)
CREATE TABLE IF NOT EXISTS publish_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id   UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  clip_id     UUID REFERENCES clips(id) ON DELETE SET NULL,
  platform    VARCHAR(50) NOT NULL,
  event       VARCHAR(100) NOT NULL,  -- started, succeeded, failed, retrying
  message     TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_upload_id ON clips(upload_id);
CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status);
CREATE INDEX IF NOT EXISTS idx_platform_tokens_user ON platform_tokens(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_publish_logs_upload ON publish_logs(upload_id);
