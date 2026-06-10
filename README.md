# TikTranslate

> Paste a TikTok link, get real-time bilingual subtitles, and let AI analyze the creator's sales pitch.

Built for Chinese cross-border e-commerce teams — no more guessing what Spanish-speaking creators are actually saying.

[中文文档](README_CN.md)

---

## Screenshots

### Main Interface

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/c29a7b59dd94c217df2b7f58f634fd7fa2b888c32e43a6066f2f0db9e4043a86.png)

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/39565c786da8aea68c17a73246f1013f37a8bcbd7a2a9c7302c234c244456084.png)

### Live Transcription

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/d9b4049c49688d7605e3c1160b4bb7103556c151b9134cac64f85cb41902a8ac.png)

### AI Analysis

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/c54393ea4c3186224dad3d25037ffda2453e881568055216fbbeccbcfc922eec.png)

---

## Features

- **TikTok URL parsing** — paste any share link; the app resolves the CDN video URL automatically
- **Real-time bilingual subtitles** — original Spanish + Chinese translation overlaid on the video as it plays
- **Subtitle list & seek** — center column shows every subtitle segment; click any line to jump to that timestamp
- **AI pitch analysis** — automatically runs after transcription completes:
  - Key selling points (tag format)
  - Content scores: Persuasion / Hook Strength / Viral Potential (0–100)
  - Script summary
- **Follow-up chat** — ask the AI multi-turn questions grounded in the full transcript and analysis (e.g. "What emotional triggers did this creator use?")
- **Password gate** — set `AUTH_TOKEN` to restrict access to your internal team
- **Light / dark theme** — one-click toggle

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 + React 19 |
| Styling | Tailwind CSS v4 |
| Language | TypeScript |
| Video parsing | [TikHub API](https://tikhub.io) |
| Transcription | Whisper via OpenRouter (or Groq) |
| AI analysis | Any OpenAI-compatible API (DeepSeek by default) |
| Auth | JWT (`jose`) |
| Package manager | pnpm |

---

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- TikHub API key (to resolve TikTok videos)
- OpenRouter API key (for Whisper transcription)
- Any OpenAI-compatible API key (for AI analysis — DeepSeek recommended)

### Install

```bash
git clone https://github.com/pseudowang/tiktranslate.git
cd tiktranslate
pnpm install
```

### Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# TikHub — resolves TikTok share URLs to CDN video URLs
TIKHUB_API_KEY=your_tikhub_key

# OpenRouter — Whisper transcription + translation
OPENROUTER_API_KEY=your_openrouter_key
WHISPER_BASE_URL=https://openrouter.ai/api/v1
WHISPER_MODEL=openai/gpt-4o-mini-transcribe

# AI analysis (any OpenAI-compatible endpoint)
ANALYSIS_API_KEY=your_analysis_key
ANALYSIS_BASE_URL=https://api.deepseek.com
ANALYSIS_MODEL=deepseek-v4-flash
ANALYSIS_VIDEO_API_KEY=your_video_analysis_key
ANALYSIS_VIDEO_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ANALYSIS_VIDEO_MODEL=qwen3.7-plus

# Access password (users enter this at the login screen)
AUTH_TOKEN=your_password

# JWT signing secret (at least 32 random characters)
JWT_SECRET=your_32_char_secret_here_change_me

# Optional: enter "test1" in the URL box to load this fixed video for testing
TEST1_VIDEO_URL=
```

### Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the password you set in `AUTH_TOKEN`.

---

## How to Use

1. **Log in** — enter the password from `AUTH_TOKEN`
2. **Paste a link** — drop a TikTok share URL into the top bar and hit parse
3. **Select source language** — defaults to Spanish (`es`); change as needed
4. **Start recognition** — click "Start Recognition"; the video plays automatically and audio capture begins
5. **Watch subtitles** — bilingual subtitles appear on the video; the center column shows the full list with click-to-seek
6. **Read the analysis** — AI analysis triggers automatically when transcription finishes; the right panel shows selling points, scores, and a summary
7. **Ask follow-up questions** — type in the input box at the bottom of the right panel

---

## Architecture

```
tiktranslate/
├── app/
│   ├── api/
│   │   ├── auth/route.ts        # validates password, returns JWT
│   │   ├── tikhub/route.ts      # proxies TikHub to resolve TikTok URLs
│   │   ├── transcribe/route.ts  # proxies Whisper; called twice per 15s chunk (transcribe + translate)
│   │   ├── analyze/route.ts     # proxies AI analysis endpoint, returns structured JSON
│   │   └── chat/route.ts        # multi-turn follow-up chat
│   ├── login/page.tsx           # login page
│   └── page.tsx                 # main app page
├── components/
│   ├── VideoPanel.tsx           # video player + subtitle overlay
│   ├── SubtitlePanel.tsx        # subtitle list + seek
│   └── AnalysisPanel.tsx        # AI analysis + follow-up chat
└── lib/
    └── auth.ts                  # JWT utilities
```

**Data flow:**

```
Paste URL → /api/tikhub → CDN video URL
    ↓
Video plays → capture audio every 15s → /api/transcribe
    ↓  (Whisper: transcribe + translate → merged bilingual segments)
Subtitle list updates + video overlay refreshes in real time
    ↓  (after video ends)
/api/analyze → AI returns selling points / scores / summary
    ↓
User asks follow-up questions → /api/chat (full transcript sent as context)
```

> API keys are server-side only and never exposed to the browser.

---

## Production Deployment

```bash
pnpm build
pnpm start
```

You can also deploy to Vercel with one click — just add all environment variables in the project settings.

---

## Customization

- **Change source language** — update `sourceLang` from `es` to any BCP-47 code (e.g. `en`, `pt`)
- **Swap AI model** — set `ANALYSIS_API_KEY` + `ANALYSIS_BASE_URL` + `ANALYSIS_MODEL` for subtitle translation and chat; set `ANALYSIS_VIDEO_API_KEY` + `ANALYSIS_VIDEO_BASE_URL` + `ANALYSIS_VIDEO_MODEL` for video analysis.
- **Swap transcription service** — set `WHISPER_BASE_URL` + `WHISPER_MODEL` to switch to Groq or any other Whisper-compatible API

---

## License

MIT
