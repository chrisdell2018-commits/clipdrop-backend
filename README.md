# ClipDrop Backend

REST API + job workers for video processing and multi-platform publishing.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend   │────▶│  API Server  │────▶│  Job Queue      │
│ (React app) │     │  (Express)   │     │  (Bull + Redis) │
└─────────────┘     └──────────────┘     └────────┬────────┘
                           │                       │
                    ┌──────▼──────┐    ┌───────────▼──────────┐
                    │  PostgreSQL │    │  Worker Process       │
                    │  (users,    │    │  - FFmpeg (split)     │
                    │   uploads,  │    │  - YouTube uploader   │
                    │   clips)    │    │  - TikTok uploader    │
                    └─────────────┘    │  - Instagram uploader │
                                       │  - Facebook uploader  │
                                       └──────────────────────┘
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Set up database
```bash
# Create a PostgreSQL database, then:
npm run db:setup
```

### 4. Start services (you need Redis running)
```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Worker (video processing + publishing)
npm run dev:worker
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Login, get JWT |
| GET  | /api/auth/me | Current user info |

### Upload
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/upload | Upload video (multipart/form-data) |
| GET  | /api/upload | List user's uploads |
| GET  | /api/upload/:id | Single upload + clips |
| DELETE | /api/upload/:id | Delete upload |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/jobs/:jobId | Get processing job status |
| GET | /api/jobs/upload/:uploadId | Get all jobs for upload |

### Platforms
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/platforms | List connected accounts |
| GET | /api/platforms/youtube/connect | Start YouTube OAuth |
| GET | /api/platforms/youtube/callback | YouTube OAuth callback |
| GET | /api/platforms/tiktok/connect | Start TikTok OAuth |
| GET | /api/platforms/tiktok/callback | TikTok OAuth callback |
| GET | /api/platforms/meta/connect | Start Meta OAuth |
| GET | /api/platforms/meta/callback | Meta OAuth callback |
| POST | /api/platforms/publish | Trigger publish for upload |
| DELETE | /api/platforms/:platform | Disconnect platform |

## Upload Request Example

```bash
curl -X POST http://localhost:3001/api/upload \
  -H "Authorization: Bearer YOUR_JWT" \
  -F "video=@myvideo.mp4" \
  -F "title=My Awesome Video" \
  -F "description=Check this out" \
  -F "tags=vlog,fun" \
  -F 'platforms={"youtube":true,"tiktok":true,"instagram":true,"facebook":false}' \
  -F "clipLength=60" \
  -F "cropStyle=auto" \
  -F "captions=true" \
  -F "autoPublish=false"
```

## Dependencies You Need Running

- **PostgreSQL** (v14+) — user data, upload tracking, clip records
- **Redis** (v6+) — job queue backing store
- **FFmpeg** — video processing (`brew install ffmpeg` or `apt install ffmpeg`)

## Deployment (Production)

Recommended stack:
- **API**: Railway or Render (auto-scales)
- **Worker**: Same platform, separate service
- **DB**: Railway PostgreSQL or Supabase
- **Redis**: Railway Redis or Upstash
- **File storage**: AWS S3 or Cloudflare R2 (replace local disk storage)
- **Captions**: OpenAI Whisper API (wire into ffmpeg.js)
