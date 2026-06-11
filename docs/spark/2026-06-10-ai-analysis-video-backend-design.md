# AI Analysis Video Backend Design

日期：2026-06-10

## 背景

`components/AnalysisPanel.tsx` 已支持 5 个 Tab：概览、视频结构、爆点话术、达人建议、追问 AI。`docs/aiAnalysis-backend-todo.md` 记录了前端已兼容但后端尚未返回的字段，包括 `overall`、`duration`、5 维 `scores`、`videoStructure`、`hooks`、`templates`。

当前 `/api/analyze` 只接收字幕数组和 `sourceLang`，再把字幕文本发给分析模型。这个链路能分析话术，但对“视觉演示”“镜头结构”“产品出现方式”等内容只能推断。用户已验证：直接传 TikHub 返回的 `videoUrl` 给百炼不可用；公共 `.mp4` URL 可以被 `qwen3.7-plus` 正常识别。第一版正式接入不引入 Cloudflare R2，而是由应用服务器下载 TikHub 视频后提供临时公网下载 URL。

本设计聚焦一个小 feature：升级 `/api/analyze`，使用“服务器临时视频 URL + 字幕”调用 `qwen3.7-plus`，返回前端完整分析结构；视频不可用时降级为字幕-only 分析。

## 目标

1. `/api/analyze` 返回 `docs/aiAnalysis-backend-todo.md` 中目标 `AnalyzeResponse` 字段。
2. 支持前端传入 `videoUrls + videoIndex`，后端下载 TikHub 视频并生成服务器临时公网 URL。
3. 支持本地开发固定测试视频 URL，通过 `ANALYSIS_TEST_VIDEO_URL` 配置。
4. 支持生产服务器公网地址配置，通过 `PUBLIC_APP_URL` 拼接临时视频下载 URL。
5. 视频调用失败时自动降级为字幕-only 分析，避免前端分析流程直接失败。
6. 返回可选 `meta` 字段记录分析模式，前端第一版可以不展示。
7. 不要求前端新增 UI；现有 `adaptAnalysis()` 可继续兼容核心分析字段。

## 非目标

- 第一版不接 Cloudflare R2、OSS 或其他对象存储。
- 第一版不让百炼访问 `localhost` 视频地址。
- 第一版不做 Base64 视频上传。
- 第一版不做抽帧兜底。
- 第一版不新增 `/api/suggest`。
- 第一版不做产品设置后端持久化。
- 第一版不重构现有字幕识别 `/api/transcribe`。

## 接口设计

`POST /api/analyze` 继续要求登录态和字幕输入。请求体扩展为：

```json
{
  "subtitles": [
    { "t": 0, "es": "Bueno...", "zh": "好..." }
  ],
  "sourceLang": "es",
  "videoUrls": ["https://tikhub-cdn.example/video-1.mp4", "https://tikhub-cdn.example/video-2.mp4"],
  "videoIndex": 0,
  "durationSec": 58
}
```

字段说明：

- `subtitles`: 必填，沿用现有结构。
- `sourceLang`: 可选，沿用现有语言归一化逻辑。
- `videoUrls`: 可选，来自 `/api/tikhub` 返回的视频地址数组。后端只把这些 URL 用于下载视频，不直接传给 Qwen。
- `videoIndex`: 可选，前端当前成功播放的视频下标。后端优先下载 `videoUrls[videoIndex]`。
- `durationSec`: 可选，用于 prompt 提供时长上下文；前端仍可自行计算时长标签。

本地开发可配置固定公网测试视频：

```bash
ANALYSIS_TEST_VIDEO_URL=https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241115/cqqkru/1.mp4
```

当配置了 `ANALYSIS_TEST_VIDEO_URL` 时，后端强制使用该测试视频 URL 作为 Qwen 输入，不下载 TikHub 视频。这个 env 只建议本地/dev 环境配置，生产环境不要配置，否则所有分析都会看同一个测试视频。

生产服务器需要配置：

```bash
PUBLIC_APP_URL=https://your-domain.com
ANALYSIS_TMP_VIDEO_DIR=/tmp/tiktranslate-analysis-videos
ANALYSIS_VIDEO_API_KEY=your_video_analysis_key
ANALYSIS_VIDEO_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ANALYSIS_VIDEO_MODEL=qwen3.7-plus
```

`PUBLIC_APP_URL` 用于拼接给 Qwen 访问的临时视频 URL，例如 `${PUBLIC_APP_URL}/api/tmp-video/<id>?token=<token>`。它不是应用启动必需项；缺失或无效时只禁用视频模式，`/api/analyze` 自动降级字幕-only。

## 视频输入选择

后端按以下优先级选择 Qwen 视频输入：

1. 配置了有效 `ANALYSIS_TEST_VIDEO_URL`：直接使用测试视频 URL，不下载 TikHub 视频。
2. 未配置测试 URL，且 `PUBLIC_APP_URL` 有效，且请求体有 `videoUrls`：后端下载 TikHub 视频，保存为临时文件，再生成服务器临时公网 URL。
3. 以上条件不满足：不传视频，走字幕-only 分析。

`ANALYSIS_TEST_VIDEO_URL` 与 `PUBLIC_APP_URL` 都要做轻量 URL 校验。`localhost`、`127.0.0.1`、`0.0.0.0`、私网 IP、带 path/query/hash 的 `PUBLIC_APP_URL` 都不能用于视频模式。`PUBLIC_APP_URL` 建议生产使用 `https` origin。

## 临时视频下载与存储

当走服务器临时 URL 模式时，后端执行：

1. 清理 `ANALYSIS_TMP_VIDEO_DIR` 下已过期目录。
2. 从 `videoUrls` 中选择最多 3 个 URL 下载：
   - 先尝试 `videoUrls[videoIndex]`。
   - 再按数组原顺序尝试剩余 URL。
   - 去重后最多尝试 3 个。
3. 每个下载请求超时 20 秒。
4. 下载过程中流式累计大小，超过 50MB 立即中止并降级。
5. 允许响应 `Content-Type` 为 `video/*` 或 `application/octet-stream`。
6. 下载成功后创建临时目录：

```text
${ANALYSIS_TMP_VIDEO_DIR}/<id>/
  video.bin
  meta.json
```

`meta.json` 包含：

```json
{
  "id": "random-id",
  "token": "high-entropy-token",
  "mimeType": "video/mp4",
  "fileName": "video.bin",
  "createdAt": "2026-06-10T00:00:00.000Z",
  "expiresAt": "2026-06-10T00:30:00.000Z",
  "sourceUrlHash": "sha256..."
}
```

token 使用高熵随机值，例如 `crypto.randomBytes(32).toString('hex')`。日志不要打印完整 token。

默认 TTL 为 30 分钟。Qwen 请求结束后安排 5 分钟延迟删除当前临时目录；如果进程退出或删除失败，则靠下一次创建前的过期目录清理兜底。

第一版做简单 SSRF 防护：

- 只允许 `http:` / `https:`。
- 明确拒绝 `localhost`、`*.localhost`。
- 如果 hostname 是 IP，拒绝私网、回环、链路本地和 metadata 地址。
- 下载重定向最多手动跟随 2 次，每次重定向后重新校验 URL。
- 第一版不做 DNS 解析后的私网 IP 检查；后续可加固。

## 临时视频访问接口

新增：

```text
app/api/tmp-video/[id]/route.ts
lib/tmpVideo.ts
```

`app/api/tmp-video/[id]/route.ts` 支持：

```http
GET  /api/tmp-video/:id?token=...
HEAD /api/tmp-video/:id?token=...
```

行为：

- 根据 `id` 读取临时目录和 `meta.json`。
- token 不匹配、过期、文件不存在都返回 `404`，不返回 `403`。
- `HEAD` 返回 `Content-Length`、`Content-Type`、`Accept-Ranges: bytes`。
- `GET` 无 Range 时返回完整文件。
- `GET` 有 `Range: bytes=start-end` 时返回 `206 Partial Content`。
- `Content-Type` 使用 `meta.mimeType`。

`lib/tmpVideo.ts` 负责：

- 校验 `ANALYSIS_TEST_VIDEO_URL` 与 `PUBLIC_APP_URL`。
- 下载 TikHub 视频。
- 创建临时目录与 metadata。
- 生成临时公网 URL。
- 读取 metadata。
- 清理过期目录。
- 安排 5 分钟延迟删除。

## Qwen 请求结构

模型调用仍使用 OpenAI-compatible Chat Completions。视频分析 API key 由 `ANALYSIS_VIDEO_API_KEY` 配置，接口地址由 `ANALYSIS_VIDEO_BASE_URL` 配置，模型由 `ANALYSIS_VIDEO_MODEL` 配置，默认 `qwen3.7-plus`，不复用字幕翻译/追问的 `ANALYSIS_API_KEY` / `ANALYSIS_BASE_URL` / `ANALYSIS_MODEL`。

```json
{
  "model": "qwen3.7-plus",
  "messages": [
    {
      "role": "system",
      "content": "你是一位专业的 TikTok 带货视频分析师，只输出 JSON。"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "video_url",
          "video_url": {
            "url": "https://your-domain.com/api/tmp-video/<id>?token=<token>"
          },
          "fps": 2
        },
        {
          "type": "text",
          "text": "以下是视频字幕和分析要求..."
        }
      ]
    }
  ]
}
```

字幕-only 降级时，`content` 可以只包含文本，或继续沿用现有字符串 prompt。为了减少改动，第一版可以封装一个 prompt 构建函数，按是否有视频 URL 返回不同的 message content。

`/api/analyze` 的 `maxDuration` 设计为 120 秒。如果部署平台不支持 120 秒，视频分析将来需要拆成异步任务；第一版先按同步请求实现。

## 返回结构契约

模型必须返回前端已支持的完整结构：

```json
{
  "overall": { "score": 8.7, "label": "高复制价值" },
  "duration": { "label": "短视频最优区间" },
  "sellingPoints": ["卖点1", "卖点2"],
  "scores": [
    { "dim": "说服力", "val": 8.7, "pct": 87 },
    { "dim": "钩子强度", "val": 9.2, "pct": 92 },
    { "dim": "爆款潜力", "val": 8.1, "pct": 81 },
    { "dim": "转化引导", "val": 8.8, "pct": 88 },
    { "dim": "视觉演示", "val": 9.0, "pct": 90 }
  ],
  "videoStructure": [
    {
      "title": "强钩子开场",
      "time": "0:00-0:05",
      "desc": "这一段如何吸引停留，以及画面/话术为什么有效。",
      "tags": ["好奇心缺口", "结果前置"]
    }
  ],
  "hooks": [
    {
      "time": "0:00",
      "src": "原文话术",
      "zh": "中文翻译",
      "tag": "⚡ 开场钩子 - 好奇心缺口"
    }
  ],
  "templates": [
    {
      "type": "开场模板",
      "text": "说真的，自从用了 [产品]，我家就再也没 [旧的麻烦做法] 过了。"
    }
  ],
  "summary": "100-200 字中文摘要。",
  "suggestedQuestions": ["追问1", "追问2", "追问3"],
  "meta": {
    "analysisMode": "video_text",
    "videoInputMode": "server_tmp_url",
    "videoObserved": true,
    "videoFallbackReason": null
  }
}
```

字段数量建议：

- `sellingPoints`: 3-5 条。
- `scores`: 固定 5 维，顺序为说服力、钩子强度、爆款潜力、转化引导、视觉演示。
- `videoStructure`: 4-6 段，覆盖完整视频时间线。
- `hooks`: 4-6 条，按时间顺序排列。
- `templates`: 4 条，覆盖开场、演示、结果、收口。
- `suggestedQuestions`: 3 条。
- `meta`: 可选调试字段，第一版前端不展示，但后端和类型应保留。

`meta` 类型：

```ts
export interface AnalysisMeta {
  analysisMode: 'video_text' | 'text_only';
  videoInputMode: 'test_url' | 'server_tmp_url' | 'none';
  videoObserved: boolean;
  videoFallbackReason:
    | null
    | 'no_video_input'
    | 'invalid_video_url'
    | 'test_video_url_invalid'
    | 'public_app_url_missing'
    | 'public_app_url_invalid'
    | 'video_download_failed'
    | 'video_too_large'
    | 'tmp_video_url_unavailable'
    | 'qwen_video_failed'
    | 'qwen_video_json_parse_failed'
    | 'qwen_video_not_observed';
}
```

`AnalyzeResponse` 增加 `meta?: AnalysisMeta`。`AnalysisData` 第一版暂不增加 `meta`，因为 UI 暂不展示。

## Prompt 要求

Prompt 应明确告诉模型：

1. 用户是国内电商从业者，目标是拆解海外 TikTok 带货视频。
2. 如果有视频输入，需要结合画面和字幕，不要只分析字幕。
3. `videoStructure.desc` 要说明“画面/话术做了什么”和“为什么有效”。
4. `hooks.src` 必须来自原语言字幕或视频话术，不要编造。
5. `hooks.zh` 必须是中文翻译。
6. `templates.text` 用 `[方括号]` 标注可替换槽位。
7. 只输出 JSON，不输出 Markdown、解释或代码块。
8. 如果模型能基于视频画面进行观察，返回 `meta.videoObserved: true`。
9. 如果没有收到视频、无法读取视频、只能基于字幕分析，返回 `meta.videoObserved: false`。
10. 不确定是否看到视频时，返回 `meta.videoObserved: false`。
11. 如果视频不可见但有字幕，仍然基于字幕完成结构化分析，并降低“视觉演示”评分。
12. text-only 模式下，`videoStructure` 仍然返回，但必须基于字幕时间轴描述，不能声称看到画面。

## 降级策略

后端执行两次以内模型调用：

1. 首次尝试：如果有可用视频 URL，调用“视频 + 字幕”分析。
2. 如果首次失败，且失败发生在模型请求、上游 4xx/5xx、超时、返回内容不可解析或核心字段缺失阶段，则调用字幕-only 分析。
3. 如果没有可用视频 URL，直接调用字幕-only 分析。
4. 如果字幕-only 也失败，再返回错误给前端。

核心字段缺失指缺少 `sellingPoints`、`scores`、`summary` 或 `suggestedQuestions`。`videoStructure`、`hooks`、`templates` 缺失不触发 fallback，因为前端有占位兜底。

如果视频模式返回了可解析 JSON，但 `meta.videoObserved !== true`：

1. 不再重跑字幕-only。
2. 后端强制修正 `meta.analysisMode = "text_only"`。
3. 后端强制修正 `meta.videoObserved = false`。
4. 后端设置 `meta.videoFallbackReason = "qwen_video_not_observed"`。
5. 后端将 `scores` 中“视觉演示”的 `val` clamp 到 `<= 6.5`，`pct` 同步 clamp 到 `<= 65`。

只要 `analysisMode` 是 `text_only`，`videoObserved` 必须是 `false`。

## 错误处理

- 无登录态：沿用 `401 unauthorized`。
- `subtitles` 缺失或为空：沿用 `400 missing_subtitles`。
- `ANALYSIS_TEST_VIDEO_URL` 不合法：不阻止启动，本次分析降级字幕-only，`meta.videoFallbackReason = "test_video_url_invalid"`。
- `PUBLIC_APP_URL` 缺失：不阻止启动，本次分析降级字幕-only，`meta.videoFallbackReason = "public_app_url_missing"`。
- `PUBLIC_APP_URL` 不合法：本次分析降级字幕-only，`meta.videoFallbackReason = "public_app_url_invalid"`。
- `videoUrls` 不合法或不可下载：降级字幕-only。
- 视频下载超过 50MB：中止下载，降级字幕-only，`meta.videoFallbackReason = "video_too_large"`。
- Qwen 视频调用失败：记录错误，降级字幕-only。
- Qwen 字幕-only 调用失败：返回 `502 llm_failed`。
- 模型没有返回 `choices[0].message.content`：返回 `500 analysis_parse_failed`。
- 模型返回非 JSON：沿用现有 `parseAnalysis()`，先直接 parse，再提取第一个 JSON object；仍失败则进入降级或最终报错。

返回给前端的 `meta.videoFallbackReason` 只能使用短错误码，不返回原始上游错误。原始错误只进入 server log，并且需要对 token、URL query 等敏感信息脱敏。

## 前端接入点

第一版后端可先不要求前端改动，因为 `ANALYSIS_TEST_VIDEO_URL` 能支持本地测试。

正式接入真实视频时，前端需要在调用 `/api/analyze` 时附带 TikHub 返回的视频 URL 数组、当前播放下标和时长：

```ts
body: JSON.stringify({
  subtitles,
  sourceLang,
  videoUrls,
  videoIndex,
  durationSec: duration,
})
```

这些 `videoUrls` 只用于后端下载视频，不会被直接传给 Qwen。本地开发可以继续不传 `videoUrls`，用 `ANALYSIS_TEST_VIDEO_URL` 验证 Qwen 视频能力。

## 验证标准

1. 不传 `videoUrls` 且不配置 `ANALYSIS_TEST_VIDEO_URL` 时，现有字幕-only 链路可用。
2. 配置 `ANALYSIS_TEST_VIDEO_URL` 后，后端会调用视频 + 字幕分析。
3. 服务器配置有效 `PUBLIC_APP_URL` 且传入可下载 `videoUrls` 时，后端会下载视频、生成临时 URL，并传给 Qwen。
4. `/api/tmp-video/:id` 支持 `GET`、`HEAD` 与 Range 请求。
5. Qwen 返回成功且 `meta.videoObserved: true` 时，`meta.analysisMode` 为 `video_text`。
6. 视频下载失败、URL 无效、`PUBLIC_APP_URL` 缺失或 Qwen 视频失败时，后端降级为字幕-only，不让前端卡死。
7. text-only 时 `meta.videoObserved` 必须为 `false`，且“视觉演示”评分不超过 6.5。
8. text-only 仍返回 `videoStructure`，但描述不能声称看到画面。
9. `scores` 固定 5 维。
10. `videoStructure`、`hooks`、`templates` 都是数组。
11. 前端 `adaptAnalysis()` 不需要结构性改动即可展示核心字段。
12. `npm run build` 或项目现有验证命令通过。

## 后续增强

第一版跑通后再考虑以下增强：

1. 如果服务器临时 URL 不稳定，再引入 R2 或 OSS 转存。
2. 如果视频 URL 方式成本或成功率不理想，再设计抽帧 + 字幕分析。
3. 如果需要达人建议更自然，再新增 `/api/suggest`。
4. 如果产品设置需要跨设备同步，再新增 `/api/products`。
