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
| 有效期 | 30 天 |
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

**Errors:**

| HTTP | error | 说明 |
|---|---|---|
| 401 | `invalid_password` | 密码与 `AUTH_TOKEN` 不匹配 |
| 400 | `missing_password` | 请求体缺少 password 字段 |

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

**Response 200:**
```json
{
  "segments": [
    { "t": 15.2, "es": "Miren, la levanto con una sola mano.", "en": "Look, I lift it with one hand." },
    { "t": 18.7, "es": "Tiene una succión de veinte mil pascales.", "en": "It has twenty thousand pascals of suction." }
  ]
}
```

`t` 已加上 `startOffset`，前端直接追加到字幕列表，无需二次处理。

**实现细节：**
- `Promise.all` 并行两次 Whisper 调用：
  - 第一次：`task: transcribe, language: es, response_format: verbose_json` → 西语原文 + 时间戳
  - 第二次：`task: translate, response_format: verbose_json` → 英文翻译（时间戳丢弃）
- 按 segment index zip：`{ t: seg1[i].start + startOffset, es: seg1[i].text, en: seg2[i]?.text ?? '' }`
- 英文 segment 数量不足时用空字符串补位
- 两次均用 `openai/whisper-large-v3`，通过 `WHISPER_BASE_URL` 配置

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
    { "t": 0, "es": "Bueno, dejen que les enseñe...", "en": "Okay, let me show you..." }
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
- `suggestedQuestions`：字符串数组，固定 3 条

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
  "question": "这个视频适合投流吗？",
  "subtitles": [
    { "t": 0, "es": "...", "en": "..." }
  ],
  "analysis": {
    "sellingPoints": ["..."],
    "scores": [{ "dim": "说服力", "val": 82, "pct": 82 }],
    "summary": "..."
  }
}
```

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

**认证流程（新增）：**
- 进入主页检查 `localStorage.getItem('tt_token')`
- 不存在 → 跳转 `/login`
- 存在 → 所有 fetch 带 `Authorization: Bearer <token>` header
- 任意 API 返回 `401` → 清除 token，跳转 `/login`

---

## 五、Env Var 清单

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
ANALYSIS_MODEL=      # 如 claude-sonnet-4-6（有默认值时可省略）
```
