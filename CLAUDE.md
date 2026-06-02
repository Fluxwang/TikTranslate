# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
pnpm dev       # start dev server at localhost:3000
pnpm build     # production build
pnpm start     # start production server
pnpm lint      # run ESLint
```

No test framework is set up yet.

## Environment Variables

All API keys live in `.env.local` (not committed):

```
TIKHUB_API_KEY=           # TikHub — fetches TikTok video URLs
OPENROUTER_API_KEY=       # OpenRouter — Whisper transcription + translation
WHISPER_BASE_URL=https://openrouter.ai/api/v1   # Whisper API base URL
ANALYSIS_API_KEY=         # AI analysis — OpenAI-compatible key
ANALYSIS_BASE_URL=        # AI analysis base URL (e.g. https://api.openai.com/v1)
AUTH_TOKEN=               # Password gate token
```

## Architecture

TikTranslate is a Next.js full-stack app that lets users paste a TikTok link, watch the video with real-time bilingual subtitles, and get AI analysis of the creator's sales pitch. Target users are Chinese e-commerce operators working with Spanish-speaking TikTok creators.

**API Routes (proxy layer — keys never reach the client):**

- `app/api/auth/route.ts` — validates password, returns token stored in `localStorage`
- `app/api/tikhub/route.ts` — proxies TikHub API to resolve TikTok share URLs to CDN video URLs
- `app/api/transcribe/route.ts` — proxies Groq Whisper; called twice per 15s audio chunk: once for Spanish transcription (keeps timestamps), once for English translation (timestamps discarded)
- `app/api/analyze/route.ts` — proxies Claude API; receives full subtitle text, returns structured JSON

**Frontend components (planned):**

- `components/VideoPlayer.tsx` — native `<video>` with `crossOrigin="anonymous"`, subtitle overlay at bottom
- `components/SubtitleList.tsx` — center column; click-to-seek, highlights current segment
- `components/AnalysisPanel.tsx` — right column; selling points, scores (0–100), summary, follow-up chat

**Shared lib:**

- `lib/audio.ts` — Web Audio API + MediaRecorder capturing audio from the video element in 15s chunks
- `lib/subtitle.ts` — merges Spanish segments (with timestamps) and English segments (text only) into unified subtitle objects
- `lib/types.ts` — shared TypeScript types

## Key Data Flow

1. User pastes TikTok link → `/api/tikhub` → returns `url_list`; try each URL in order (CDN URLs are ephemeral, never cache)
2. `<video>` loads and plays; Web Audio API starts capturing
3. Every 15s: audio chunk → `/api/transcribe` → two Whisper calls → merged bilingual segments → subtitle overlay + list update
4. On transcription complete → `/api/analyze` → Claude returns `{ selling_points, scores: { persuasion, hook, viral_potential }, summary }`
5. Follow-up chat sends full subtitle text + analysis JSON as context

## Layout

Three-column desktop-only layout (no mobile responsive):

- Left (5fr): video player + subtitle overlay
- Center (4fr): subtitle list with click-to-seek
- Right (5fr): AI analysis cards + follow-up chat
