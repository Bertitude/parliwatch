# ParliWatch

Time-coded transcriptions and AI summaries of YouTube parliamentary sessions.
Primary target: **Parliament of Barbados** — but works with any YouTube URL.
API-first — no GPU required.

---

## Features

| Feature | Details |
|---------|---------|
| **Free transcription** | YouTube auto-captions, instant, $0 |
| **Enhanced transcription** | OpenAI gpt-4o-mini-transcribe, ~$0.003/min |
| **Speaker-labelled transcription** | OpenAI gpt-4o-transcribe, ~$0.006/min |
| **Live stream transcription** | Groq Whisper, real-time SSE, ~$0.00004/min |
| **AI Summary** | Anthropic Claude — executive summary, topics, decisions, actions, speakers |
| **Export** | Markdown (with timecodes), SRT, WebVTT, plain text, JSON, DOCX summary, ZIP bundle |
| **Video sync** | Click any transcript segment to jump to that moment in the video |
| **Search** | Full-text search across the transcript |

---

## Prerequisites

Install these before running the setup script:

| Tool | Version | Download |
|------|---------|---------|
| **Python** | 3.11 or higher | https://python.org/downloads |
| **Node.js** | 18 or higher | https://nodejs.org |
| **Docker Desktop** | Latest | https://docker.com/products/docker-desktop |
| **ffmpeg** | Latest | https://ffmpeg.org/download.html — add to PATH |

> **Windows tip:** Add `ffmpeg\bin` to your system PATH so `ffmpeg` works from any terminal.

---

## Quick Setup (Windows)

```powershell
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/parliwatch.git
cd parliwatch

# 2. Run the automated setup (creates venv, installs deps, copies .env template)
.\setup.ps1

# 3. Edit backend\.env and fill in your API keys (see below)
notepad backend\.env

# 4. Start everything
.\start.bat
```

Open **http://localhost:3000** in your browser.

---

## Manual Setup

### 1. Start databases

```bash
docker compose up -d
```

This starts PostgreSQL (port 5432) and Redis (port 6379).

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux

pip install -r requirements.txt

copy .env.example .env         # Windows
# cp .env.example .env         # Mac/Linux

# Edit .env and add your API keys
uvicorn app.main:app --reload
```

API available at **http://localhost:8000** — interactive docs at `/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## API Keys

Edit `backend/.env` after setup:

| Key | Where to get it | Used for |
|-----|----------------|---------|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | Enhanced transcription |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | AI summaries |
| `GROQ_API_KEY` | https://console.groq.com | Live stream transcription |

The **free tier** (YouTube captions) works without any API keys.

---

## Transcription Tiers

| Tier | Select as | Cost | Notes |
|------|-----------|------|-------|
| Free | `free` | $0 | Uses YouTube's auto-generated captions |
| Enhanced | `mini` | ~$0.003/min | OpenAI gpt-4o-mini, high accuracy |
| Speaker labels | `diarization` | ~$0.006/min | OpenAI gpt-4o, identifies who is speaking |
| Live stream | auto-detected | ~$0.00004/min | Groq Whisper, real-time 30s chunks |

---

## Project Structure

```
parliwatch/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI routes (10 endpoints)
│   │   ├── models.py                # SQLAlchemy ORM models
│   │   ├── youtube.py               # URL parsing + yt-dlp metadata
│   │   └── services/
│   │       ├── transcript.py        # YouTube captions (free tier)
│   │       ├── audio.py             # yt-dlp + ffmpeg audio download
│   │       ├── openai_transcribe.py # OpenAI transcription
│   │       ├── groq_transcribe.py   # Groq Whisper transcription
│   │       ├── livestream.py        # Live stream pipeline (ffmpeg → Groq → SSE)
│   │       ├── summarizer.py        # Claude API summaries
│   │       ├── summary_export.py    # DOCX + Markdown summary export
│   │       └── processor.py        # Orchestration
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── app/                     # Next.js App Router pages
│       ├── components/              # React components
│       └── lib/                     # API client + utilities
├── docker-compose.yml               # PostgreSQL + Redis
├── setup.ps1                        # Automated setup (Windows)
└── start.bat                        # Start all services (Windows)
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Create session (auto-routes live vs recorded) |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/{id}` | Session status + metadata |
| `GET` | `/api/sessions/{id}/transcript?format=json\|srt\|vtt\|txt\|md` | Download transcript |
| `GET` | `/api/sessions/{id}/summary` | Get AI summary (JSON) |
| `POST` | `/api/sessions/{id}/summarize` | Trigger AI summary generation |
| `GET` | `/api/sessions/{id}/summary/download?format=md\|docx` | Download summary file |
| `GET` | `/api/sessions/{id}/export/bundle` | Download ZIP (all formats) |
| `GET` | `/api/sessions/{id}/live-transcript` | SSE stream for live transcription |
| `POST` | `/api/sessions/{id}/stop` | Stop live transcription |
| `GET` | `/api/sessions/{id}/cost` | API cost breakdown |
| `GET` | `/api/health` | Health check |

---

## Tech Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS
- **Backend:** FastAPI, Python 3.11+, SQLAlchemy (async)
- **Database:** PostgreSQL 16
- **Cache:** Redis 7
- **AI:** Groq Whisper (live), OpenAI gpt-4o (recorded), Anthropic Claude (summaries)
- **Audio:** yt-dlp, ffmpeg
