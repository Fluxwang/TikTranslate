# Repository Guidelines

## Project Structure & Module Organization

TikTranslate is a Next.js 16 App Router project. Pages and server routes live in `app/`: `app/page.tsx` is the main client UI, `app/login/page.tsx` handles login, and `app/api/*/route.ts` contains backend proxies for auth, TikHub, transcription, analysis, chat, and temporary video access. Reusable UI belongs in `components/`, shared utilities and types in `lib/`, static assets in `public/`, and planning notes in `docs/`. Experimental scripts belong under `experiments/`.

## Build, Test, and Development Commands

Use pnpm, as pinned in `package.json`.

- `pnpm install` installs dependencies.
- `pnpm dev` starts the local Next.js dev server.
- `pnpm build` creates a production build and validates types.
- `pnpm start` serves the production build.
- `pnpm lint` runs ESLint with Next.js and TypeScript rules.
- `pnpm demo:qwen-video` runs the Qwen video experiment script.
- `pnpm doctor` runs React diagnostics via `react-doctor`.

## Coding Style & Naming Conventions

Write TypeScript with `strict` mode in mind. Use functional React components, hooks, and shared types from `lib/types.ts` when data crosses component or API boundaries.

Formatting is enforced by Prettier (`.prettierrc.json`) — run `pnpm format` before committing, or `pnpm format:check` to verify. Do not hand-format; the config is the single source of truth: two-space indentation, **double quotes**, semicolons, trailing commas, 100-column print width.

Naming stays manual: PascalCase component files such as `VideoPanel.tsx`, camelCase functions, variables, and route helpers. Import project modules through the `@/*` alias when it improves clarity. Keep global styling in `app/globals.css` and prefer existing design tokens.

## Testing Guidelines

Run `pnpm test` (Vitest), `pnpm lint`, and `pnpm build` before opening a PR.

**Scope of automated tests — this is a deliberate boundary, not a gap.** Only the pure functions under `lib/` are unit-tested: they have no dependencies, and they cover the highest-risk logic in the project (normalising untrusted LLM output, SSRF URL filtering). Tests are colocated as `lib/<module>.test.ts`.

Components and hooks are **not** unit-tested. They depend on `MediaRecorder`, `HTMLVideoElement.captureStream()`, and playback timing; mocking those faithfully costs far more than it returns, and a passing test against a hand-rolled mock gives false confidence. They are covered by small, reviewable commits plus manual verification instead.

So for any UI or recording change, manually verify: login flow, TikTok URL parsing, transcription start/stop, analysis generation, and follow-up chat. If E2E tests are added later, put them under a clearly named `tests/` directory.

## Commit & Pull Request Guidelines

Recent history uses a mix of Conventional Commit prefixes, English summaries, and concise Chinese descriptions, for example `feat: ...`, `docs: ...`, and direct Chinese summaries. Prefer a clear one-line subject and add a prefix when useful (`feat:`, `fix:`, `docs:`, `refactor:`). Pull requests should include purpose, key notes, manual verification, linked issues when applicable, and screenshots or recordings for UI changes.

## Security & Configuration Tips

Never commit `.env.local` or real API keys. Keep secrets server-side in variables documented by `.env.example`, including TikHub, OpenRouter/Whisper, analysis API, `AUTH_TOKEN`, and `JWT_SECRET`. API routes should continue proxying third-party services from the server so browser code does not expose credentials.
