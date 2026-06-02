# TikTranslate 后端 API Design

**日期：** 2026-06-02  
**版本：** V1  
**范围：** 5 条 Next.js App Router Route Handlers + 共享 auth 工具

---

## 一、整体架构

```
app/api/
  auth/route.ts          POST /api/auth       — 登录，返回 JWT
  tikhub/route.ts        POST /api/tikhub     — 解析 TikTok 链接
  transcribe/route.ts    POST /api/transcribe — 双语字幕（并行 Whisper）
  analyze/route.ts       POST /api/analyze    — AI 内容分析
  chat/route.ts          POST /api/chat       — 追问 AI
lib/
  auth.ts                signJWT / verifyJWT（所有 route 共用）
```

**设计原则：**
- 方案 B（智能 Route Handler）：route 内部完成转换，返回前端直接可用的 shape
- 唯一共享逻辑：JWT 验证抽成 `lib/auth.ts`，其余各 route 独立
- 所有 API Key 存服务端 `.env.local`，不暴露给前端

---

## 二、认证设计

### JWT 规范

| 项目 | 值 |
|---|---|
| 算法 | HS256 |
| 密钥 | `JWT_SECRET` env var，随机字符串 ≥32 位 |
| Payload | `{ iat: number }` |
| 有效期 | 90 天 |
| 前端存储 | `localStorage` key `tt_token` |
| 请求携带方式 | `Authorization: Bearer <token>` header |

### `lib/auth.ts` 接口

```ts
export function signJWT(): string
export function verifyJWT(req: Request): void  // 校验失败 throw，route catch 后返回 401
```

### 统一错误格式

所有 route 共用同一错误结构：

```json
{ "error": "error_code", "detail": "可选的调试说明（不展示给用户）" }
```

`error` 供前端逻辑判断，`detail` 仅用于日志/console。

---

## 三、API Route 详细契约

### `POST /api/auth`

不需要 Authorization header。

**Request:**
```json
{ "password": "string" }
```

**Response 200:**
```json
{ "token": "eyJ..." }
```

**限速（防暴力破解）：**

同一 IP 每 15 分钟最多尝试 10 次，超过返回 `429`。使用进程内 `Map` 实现，无需 Redis，进程重启后计数清零（内部工具可接受）：

```ts
const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}
```

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 401 | `invalid_password` | 密码与 `AUTH_TOKEN` 不匹配 |
| 400 | `missing_password` | 请求体缺少 password 字段 |
| 429 | `too_many_attempts` | 同一 IP 15 分钟内超过 10 次失败 |

---

### `POST /api/tikhub`

**Request:**
```json
{ "url": "https://www.tiktok.com/@xxx/video/123 或分享短链" }
```

**后端调用 TikHub：**
```
GET https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_one_video_by_share_url
    ?share_url={url}
Header: Authorization: Bearer ${TIKHUB_API_KEY}
```

**从 TikHub 响应提取：**

| 返回字段 | TikHub 路径 |
|---|---|
| `videoUrls` | `data.aweme_detail.video.play_addr_h264.url_list`（完整数组） |
| `author` | `data.aweme_detail.author.unique_id` |
| `durationSec` | `data.aweme_detail.video.duration / 1000`（毫秒转秒） |
| `coverUrl` | `data.aweme_detail.video.cover.url_list[0]` |

**Response 200:**
```json
{
  "videoUrls": ["https://cdn1...", "https://cdn2...", "https://cdn3..."],
  "author": "@casalimpia.mx",
  "durationSec": 58,
  "coverUrl": "https://..."
}
```

前端 `<video>` 按 `videoUrls` 顺序 try，第一个能播就用。CDN URL 有时效，前端不可缓存。

**跨域风险：** `<video crossOrigin="anonymous">` 依赖 TikTok CDN 返回 `Access-Control-Allow-Origin` 头才能让 Web Audio API 捕获音频。V1 先直连测试，若 CDN 不支持跨域导致音频捕获失败，启用备选方案：[video-proxy-fallback.md](./2026-06-02-video-proxy-fallback.md)。

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `invalid_url` | url 字段缺失或格式非法 |
| 401 | `unauthorized` | JWT 无效或过期 |
| 502 | `tikhub_failed` | TikHub 返回非 2xx 或 url_list 为空，`detail` 带 TikHub status code |

---

### `POST /api/transcribe`

`multipart/form-data`，每 15 秒由前端触发一次。

**Request fields:**

| 字段 | 类型 | 说明 |
|---|---|---|
| `audio` | Blob | MediaRecorder 输出（webm/wav），上限 25MB |
| `startOffset` | string | 本片段在完整视频中的起始秒数，如 `"15"` |
| `sourceLang` | string（可选） | 视频语言 ISO 639-1 代码，默认 `"es"`，留空时 Whisper 自动检测 |

**Response 200:**
```json
{
  "segments": [
    { "t": 15.2, "es": "Miren, la levanto con una sola mano.", "zh": "看，我单手就能举起来。" },
    { "t": 18.7, "es": "Tiene una succión de veinte mil pascales.", "zh": "吸力高达两万帕，超强劲。" }
  ]
}
```

`t` 已加上 `startOffset`，前端直接追加到字幕列表，无需二次处理。

**实现细节：**
- 第一步：Whisper 转录
  - `task: transcribe, language: {sourceLang ?? 'es'}, response_format: verbose_json` → 原文 + 时间戳
- 第二步：LLM 中文翻译（替换原 Whisper translate，因 Whisper 只能译成英文）
  - 提取所有 segment 文本 → 一次 LLM 调用批量翻译成中文 → 返回等长字符串数组
  - 使用 `ANALYSIS_BASE_URL` + `ANALYSIS_API_KEY`（与 `/api/analyze` 共用同一 AI provider）
- 翻译失败处理（inline retry）：
  1. 翻译 rejected → 原地重试一次
  2. 重试仍失败 → `zh` 字段用空字符串补位，原文照常返回
  3. Whisper 转录失败 → 整个 chunk 返回 `502 whisper_failed`
- 按 segment index zip：`{ t: seg[i].start + startOffset, es: seg[i].text, zh: translations[i] ?? '' }`
- retry 对前端透明，前端无需特殊处理

**Route 配置（必须）：**
```ts
export const maxRequestBodySize = '25mb';  // 覆盖 Next.js App Router 默认 4MB 限制
export const maxDuration = 60;             // Whisper + LLM 翻译最坏情况接近 25s，留足余量
```
不加 `maxRequestBodySize`，高码率音频会在 Next.js 层触发 413，与 Whisper 无关。

**暂停处理（前端实现要点）：**
- 视频暂停时调用 `mediaRecorder.pause()`，恢复播放时调用 `mediaRecorder.resume()`，避免将静音录入片段
- `startOffset` 使用 `video.currentTime` 计算（非挂钟时间），确保时间戳在暂停后仍对齐视频播放位置

**最后片段 flush（前端实现要点）：**
- 前端监听 `<video>` 的 `ended` 事件
- 视频播放结束时立即将当前未满 15 秒的音频片段强制发送（即使只有几秒）
- flush 完成后 `setPhase('recognized')`，触发 AI 分析
- 若不处理，最后一段音频永远不会发出，字幕缺尾且 `phase` 卡在 `recognizing`

**已知限制（V1）：** 15 秒边界处可能出现句子截断，不做 overlap window 处理。

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `missing_audio` | 未上传 audio 字段 |
| 401 | `unauthorized` | JWT 无效或过期 |
| 413 | `audio_too_large` | 超过 25MB |
| 502 | `whisper_failed` | Whisper API 返回非 2xx |

---

### `POST /api/analyze`

识别完成后前端自动触发一次。

**Request:**
```json
{
  "subtitles": [
    { "t": 0, "es": "Bueno, dejen que les enseñe...", "zh": "好，让我来告诉你为什么..." }
  ]
}
```

**Response 200:**
```json
{
  "sellingPoints": ["20000Pa 大吸力", "重量 < 1.5kg", "续航 45 分钟"],
  "scores": [
    { "dim": "说服力",   "val": 82, "pct": 82 },
    { "dim": "钩子强度", "val": 75, "pct": 75 },
    { "dim": "爆款潜力", "val": 90, "pct": 90 }
  ],
  "summary": "达人以「我家不再扫地」作为强钩子开场...",
  "suggestedQuestions": ["这个视频适合投流吗？", "帮我写一条类似脚本", "钩子还能怎么优化？"]
}
```

**字段约束：**
- `sellingPoints`：字符串数组，3–8 条，每条 ≤15 字
- `scores`：固定三条，`dim` 固定为 `说服力` / `钩子强度` / `爆款潜力`，`val` 为 0–100 整数，`pct` 等于 `val`
- `suggestedQuestions`：字符串数组，固定 3 条，中文，针对视频内容

**Prompt 骨架：**
```
System:
你是一位专业的 TikTok 带货话术分析师，服务于国内电商从业者。
用户会提供一段 TikTok 视频的完整字幕（西语原文 + 中文翻译），
你需要分析达人的带货话术并返回结构化 JSON，不要输出任何 JSON 以外的内容。

User:
以下是视频字幕：
{字幕列表，格式：[时间戳] 西语 / 中文，每条一行}

请按以下 JSON 格式输出分析结果：
{
  "sellingPoints": ["卖点1", "卖点2", ...],   // 3–8 条，每条不超过 15 字
  "scores": [
    { "dim": "说服力",   "val": 0-100整数, "pct": 同val },  // 话术逻辑是否清晰、有说服力
    { "dim": "钩子强度", "val": 0-100整数, "pct": 同val },  // 开场前3秒能否抓住注意力
    { "dim": "爆款潜力", "val": 0-100整数, "pct": 同val }   // 内容传播性与情绪共鸣度
  ],
  "summary": "100–200字的话术摘要，重点分析开场钩子、实证方式、收口转化",
  "suggestedQuestions": ["追问1", "追问2", "追问3"]  // 3条，中文，基于视频内容
}
```

**JSON 解析失败策略：**
1. 先 `JSON.parse(content)`
2. 失败 → 正则提取 `/{[\s\S]*}/` 后再 parse
3. 仍失败 → `500 analysis_parse_failed`

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `missing_subtitles` | subtitles 字段缺失或为空数组 |
| 401 | `unauthorized` | JWT 无效或过期 |
| 500 | `analysis_parse_failed` | 模型返回非合法 JSON |
| 502 | `llm_failed` | AI API 返回非 2xx |

---

### `POST /api/chat`

每次追问携带完整上下文，无服务端会话状态。

**Request:**
```json
{
  "question": "预算大概多少？",
  "history": [
    { "role": "user",      "content": "这个视频适合投流吗？" },
    { "role": "assistant", "content": "适合，钩子强度 9.2..." }
  ],
  "subtitles": [
    { "t": 0, "es": "...", "zh": "..." }
  ],
  "analysis": {
    "sellingPoints": ["..."],
    "scores": [{ "dim": "说服力", "val": 82, "pct": 82 }],
    "summary": "..."
  }
}
```

`history` 为可选字段，第一次追问时为空数组或省略。后端将 `history` + 当前 `question` 拼成完整 `messages` 数组传给 LLM，服务端不保存任何状态。

**对话历史上限（前端实现要点）：** 前端发送前将 `history` 截断为最近 10 轮（20 条消息），超出部分从头部丢弃。避免长对话累积导致 token 超限或费用异常，后端无需感知。

**Response 200:**
```json
{ "answer": "适合。钩子强度 9.2，前 3 秒留存大概率达标..." }
```

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 400 | `missing_question` | question 字段缺失或为空 |
| 401 | `unauthorized` | JWT 无效或过期 |
| 502 | `llm_failed` | AI API 返回非 2xx |

---

## 四、前端状态机替换契约

`page.tsx` 中每个 mock 操作对应的真实替换：

| 当前 demo 行为 | 替换为 |
|---|---|
| `onParse` → `setTimeout 1400ms` | `POST /api/tikhub` 成功后 `setPhase('loaded')`，`videoUrls` 存 state |
| 视频来源：`DEMO_DATA.meta` | `<video src={videoUrls[0]}>` 失败时依次 try `videoUrls[1]`, `[2]` |
| 字幕来源：`DEMO_DATA.subtitles` 静态数组 | 每 15 秒 `POST /api/transcribe` → `segments` 追加到字幕 state |
| `recognizedCount` 模拟推进 | 改为字幕数组实际长度，录制结束时 `setPhase('recognized')` |
| `onStartAnalysis` → setTimeout 级联 | `POST /api/analyze` 成功后一次性填充 `analysisData` state |
| `onSend` → `setTimeout 1100ms` | `POST /api/chat` → `answer` 填入 thread |

**前端同步修改：**
- `components/SubtitlePanel.tsx`：字幕字段 `s.en` → `s.zh`（目标语言已改为中文）
- `lib/demo-data.ts`：`subtitles` 数组中 `en` 字段改为 `zh`，值替换为中文翻译（用于开发阶段 demo 预览）

**认证流程（新增）：**
- 进入主页检查 `localStorage.getItem('tt_token')`
- 不存在 → 跳转 `/login`
- 存在 → 所有 fetch 带 `Authorization: Bearer <token>` header
- 任意 API 返回 `401` → 清除 token，跳转 `/login`

---

## 五、部署超时配置

`/api/transcribe`、`/api/analyze`、`/api/chat` 均涉及外部 AI API 调用，需在两处统一设置超时：

**Next.js Route Segment Config（各 route 文件顶部）：**
```ts
export const maxDuration = 60;  // 单位秒，transcribe 已含此配置，analyze/chat 同样需要
```

**Caddyfile：**
```
reverse_proxy localhost:3000 {
    transport http {
        response_header_timeout 60s
    }
}
```
不配置时 Caddy 默认 30 秒，偶发慢响应会被直接断掉，前端收到 502 无法区分超时与真实失败。

---

## 六、Env Var 清单

`.env.local` 完整变量（比 brief 多了 `JWT_SECRET`）：

```bash
# 认证
AUTH_TOKEN=          # 用户登录密码（明文，后端对比）
JWT_SECRET=          # JWT 签名密钥，随机字符串 ≥32 位

# TikHub
TIKHUB_API_KEY=      # TikHub API key

# Whisper（OpenRouter）
OPENROUTER_API_KEY=
WHISPER_BASE_URL=https://openrouter.ai/api/v1

# AI 分析
ANALYSIS_API_KEY=    # OpenAI 兼容 key
ANALYSIS_BASE_URL=   # 如 https://api.anthropic.com/v1
ANALYSIS_MODEL=      # 可选，默认 claude-sonnet-4-6；代码 fallback: process.env.ANALYSIS_MODEL ?? 'claude-sonnet-4-6'
```
