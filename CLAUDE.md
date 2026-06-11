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
WHISPER_MODEL=            # e.g. openai/gpt-4o-mini-transcribe
ANALYSIS_API_KEY=         # AI analysis — OpenAI-compatible key
ANALYSIS_BASE_URL=        # AI analysis base URL (e.g. https://api.deepseek.com)
ANALYSIS_MODEL=           # e.g. deepseek-v4-flash
AUTH_TOKEN=               # Password gate token (checked in /api/auth)
JWT_SECRET=               # >= 32 chars, signs the auth JWT
TEST1_VIDEO_URL=          # optional: entering "test1" as the URL loads this fixed video for testing
```

## Architecture

TikTranslate is a Next.js full-stack app that lets users paste a TikTok link, watch the video with real-time bilingual subtitles, and get AI analysis of the creator's sales pitch. Target users are Chinese e-commerce operators working with Spanish-speaking TikTok creators.

**API Routes (proxy layer — keys never reach the client):**

- `app/api/auth/route.ts` — validates password against `AUTH_TOKEN`, returns a JWT (`jose`); per-IP rate limited (in-memory)
- `app/api/tikhub/route.ts` — proxies TikHub API to resolve TikTok share URLs to CDN video URLs (`videoUrls`); also handles the `test1` debug alias via `TEST1_VIDEO_URL`
- `app/api/transcribe/route.ts` — proxies Whisper (via `WHISPER_BASE_URL`/`WHISPER_MODEL`); called twice per 15s audio chunk: once for source-language transcription (keeps timestamps), once for translation (timestamps discarded)
- `app/api/analyze/route.ts` — proxies `ANALYSIS_BASE_URL`/`ANALYSIS_MODEL` (any OpenAI-compatible chat completions endpoint); receives the full subtitle transcript, returns `{ sellingPoints, scores, summary, suggestedQuestions }` as JSON
- `app/api/chat/route.ts` — multi-turn follow-up chat against the same `ANALYSIS_*` endpoint; receives the question, chat history, full transcript, and the analysis result as context

All routes except `/api/auth` call `verifyJWT(req)` from `lib/auth.ts` and return `401 unauthorized` on failure — the frontend's `authedFetch` wrapper (in `app/page.tsx`) attaches the token and redirects to `/login` on 401.

**Frontend components:**

- `components/TopBar.tsx` — URL input, source-language selector, parse/start controls, theme toggle
- `components/VideoPanel.tsx` — native `<video crossOrigin="anonymous">` with bilingual subtitle overlay
- `components/SubtitlePanel.tsx` — subtitle list with click-to-seek and recognition progress
- `components/AnalysisPanel.tsx` — right column; 5-tab AI sidebar (概览 / 视频结构 / 爆点话术 / 达人建议 / 追问 AI) plus a product-settings page

**Shared lib:**

- `lib/types.ts` — shared TypeScript types (`Subtitle`, `AnalyzeResponse`, `AnalysisData`, `Product`, etc.)
- `lib/analysis.ts` — `adaptAnalysis()` maps the raw `/api/analyze` response onto the full `AnalysisData` shape the panel needs, filling in fields the backend doesn't return yet with computed/placeholder values (see `docs/aiAnalysis-backend-todo.md` for the gap list); also handles product-settings persistence (`localStorage`) and the local template-based creator-suggestion generator
- `lib/auth.ts` — JWT sign/verify (`jose`)

## Key Data Flow

1. User pastes TikTok link → `/api/tikhub` → returns `videoUrls`; try each URL in order (CDN URLs are ephemeral, never cache)
2. `<video>` loads; on "Start Recognition" it plays and a `MediaRecorder` (via `captureStream()`) starts capturing audio
3. Every 15s: audio chunk → `/api/transcribe` → two Whisper calls (transcribe + translate) → merged bilingual segments → subtitle overlay + list update
4. On transcription complete → `/api/analyze` → returns `{ sellingPoints, scores, summary, suggestedQuestions }`, adapted via `adaptAnalysis()` into the full `AnalysisData` shown across the 5 analysis tabs
5. Follow-up chat sends full subtitle transcript + analysis JSON as context to `/api/chat`

`docs/aiAnalysis-backend-todo.md` tracks the AnalysisPanel fields that are already wired up in the UI but still need backend support.

## Layout

Three-column desktop-only layout (no mobile responsive):

- Left (5fr): video player + subtitle overlay
- Center (4fr): subtitle list with click-to-seek
- Right (5fr): AI analysis cards + follow-up chat
