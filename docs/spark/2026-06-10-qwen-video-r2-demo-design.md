# Qwen Video R2 Demo Design

日期：2026-06-10

## 背景

现有 `/api/analyze` 只接收字幕数组和 `sourceLang`，后端把字幕文本发送给分析模型，前端通过 `lib/analysis.ts` 兼容缺失字段。新的后端 TODO 需要补齐 `videoStructure`、`hooks`、`templates`、5 维 `scores` 等字段，其中“视觉演示”相关信息仅靠字幕不够稳定。

用户已经验证：直接把 TikHub 返回的 `videoUrl` 传给模型不可用。用户希望先做一个独立最小 demo，验证 Cloudflare R2 与 `qwen3.7-plus` 视频理解链路。

本设计只覆盖一个小 feature：新建独立 demo 文件夹，验证视频输入方式。暂不改现有 `/api/analyze`、前端 5 Tab 或字幕识别流程。

## 目标

在 `experiments/qwen-video-r2-demo/` 下实现一个最小化 demo，用于验证：

1. 可以通过环境变量直接配置一个公网视频 URL。
2. 优先把该公网 URL 作为 `video_url` 传给 `qwen3.7-plus`。
3. 未配置公网 URL 时，本地短视频可以上传到 Cloudflare R2。
4. R2 模式下 demo 可以生成可供外部服务访问的 R2 临时 URL。
5. 如果 URL 输入失败，自动改用同一视频的 Base64 data URL 再请求一次。
6. 模型返回受限 JSON，便于后续接入正式 `/api/analyze`。

## 非目标

- 不接入现有 `/api/analyze`。
- 不改 `components/AnalysisPanel.tsx`。
- 不做完整 `AnalyzeResponse` 字段补齐。
- 不做字幕融合分析。
- 不做生产级队列、重试任务、审计后台或用户文件管理。
- 不长期保存视频文件。

## 输入与配置

demo 优先读取公网视频链接环境变量：

```bash
QWEN_VIDEO_PUBLIC_URL=https://example.com/video.mp4 pnpm demo:qwen-video
```

未配置 `QWEN_VIDEO_PUBLIC_URL` 时，demo 使用命令行方式运行，输入一个本地视频文件路径：

```bash
pnpm demo:qwen-video ./samples/video.mp4
```

需要以下环境变量：

```bash
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=...
QWEN_MODEL=qwen3.7-plus
QWEN_VIDEO_PUBLIC_URL=https://example.com/video.mp4

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_BASE_URL=...
```

`QWEN_VIDEO_PUBLIC_URL` 是可选但优先级最高的输入源。配置后 demo 不上传 R2，也不读取本地文件，直接按阿里云百炼官方示例把该 URL 放入 `video_url.url`。

`R2_PUBLIC_BASE_URL` 可以是 R2 public bucket URL、custom domain，或后续签名 URL 生成逻辑的基础地址。第一版 demo 只要求生成一个模型服务端能访问的 HTTPS URL。

## 数据流

1. 如果配置了 `QWEN_VIDEO_PUBLIC_URL`，校验它是 `http` 或 `https` URL，并将其作为视频输入 URL。
2. 如果未配置 `QWEN_VIDEO_PUBLIC_URL`，CLI 校验输入视频存在、可读、大小不为 0。
3. 读取视频 MIME 类型，默认 `video/mp4`。
4. 上传视频到 R2，object key 使用 `qwen-video-demo/<timestamp>-<random>.mp4`。
5. 生成 R2 视频 URL。
6. 调用 Qwen OpenAI-compatible Chat Completions：

```json
{
  "model": "qwen3.7-plus",
  "messages": [
    {
      "role": "system",
      "content": "你是短视频带货内容分析助手，只输出 JSON。"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "video_url",
          "video_url": { "url": "https://..." },
          "fps": 2
        },
        {
          "type": "text",
          "text": "分析这个视频并按指定 JSON 返回。"
        }
      ]
    }
  ]
}
```

7. 如果 `QWEN_VIDEO_PUBLIC_URL` 模式成功，输出 `inputMode: "public_url"`。
8. 如果 R2 URL 模式成功，输出 `inputMode: "r2_url"`。
9. 如果 URL 模式失败，并且存在本地视频文件，读取原始文件并转成 Base64 data URL：

```json
{
  "type": "video_url",
  "video_url": {
    "url": "data:video/mp4;base64,..."
  },
  "fps": 2
}
```

10. 如果 Base64 模式成功，输出 `inputMode: "base64"`，并保留 URL 模式失败摘要。
11. 如果 URL 与 Base64 模式都失败，输出结构化错误。
12. 如果创建过 R2 object，请求结束后删除 R2 object，避免临时视频残留。

## 返回结构

demo 标准输出为 JSON：

```json
{
  "ok": true,
  "inputMode": "public_url",
  "summary": "视频内容摘要",
  "visualMoments": [
    {
      "time": "0:00-0:03",
      "desc": "画面描述"
    }
  ],
  "productSignals": ["产品外观", "使用场景", "效果展示"],
  "urlAttemptError": null,
  "error": null
}
```

字段约束：

- `ok`: 是否最终成功。
- `inputMode`: `"public_url"`、`"r2_url"`、`"base64"` 或 `"failed"`。
- `summary`: 1-3 句中文摘要。
- `visualMoments`: 3-6 个视觉片段，按时间顺序排列。
- `productSignals`: 0-6 个从画面中识别到的带货信号。
- `urlAttemptError`: 仅在 URL 模式失败但 Base64 成功时返回简短错误摘要。
- `error`: 两种模式都失败时返回最终错误摘要。

## 错误处理

- `QWEN_VIDEO_PUBLIC_URL` 不是 HTTP/HTTPS URL：立即失败。
- 配置了 `QWEN_VIDEO_PUBLIC_URL` 时，该 URL 调用失败：不做 Base64 兜底，因为 demo 没有本地视频文件可读。
- 本地文件不存在：立即失败，不调用 R2 或 Qwen。
- R2 上传失败：立即失败。
- URL 模式 Qwen 调用失败：记录错误，进入 Base64 兜底。
- Base64 文件过大导致请求失败：返回 `inputMode: "failed"`，错误中明确说明需要压缩视频或抽帧。
- 模型返回非 JSON：尝试从文本中提取第一个 JSON object；仍失败则报 `model_json_parse_failed`。
- R2 删除失败：不影响主结果，但在 stderr 输出清理失败信息。

## 验证标准

使用一个 5-20 秒、体积尽量小于 20MB 的 TikTok/短视频样例运行 demo。

验收条件：

公网 URL 模式验收条件：

1. 配置 `QWEN_VIDEO_PUBLIC_URL` 后，demo 不要求本地视频文件。
2. demo 直接把该 URL 放入 `video_url.url`。
3. 成功时 stdout 是合法 JSON。
4. JSON 中 `visualMoments` 至少包含 3 条画面描述。

本地文件/R2 模式验收条件：

1. R2 中能看到临时对象被创建。
2. demo 优先尝试 R2 URL。
3. R2 URL 失败时能自动进入 Base64 兜底。
4. 成功时 stdout 是合法 JSON。
5. JSON 中 `visualMoments` 至少包含 3 条画面描述。
6. 运行结束后 R2 临时对象被删除。

## 后续接入路径

如果 demo 证明 `qwen3.7-plus` 能稳定处理 R2 URL 或 Base64 视频，下一步再设计正式 `/api/analyze` 接入：

1. `/api/tikhub` 返回或缓存可下载视频信息。
2. `/api/analyze` 接收 `videoUrl` 或视频对象 key，加上字幕数组。
3. 后端执行视频输入准备：R2 URL 优先，Base64 兜底。
4. Prompt 要求返回 `docs/aiAnalysis-backend-todo.md` 中的完整 `AnalyzeResponse` 结构。
5. 前端继续通过 `adaptAnalysis()` 兼容逐字段上线。

## 参考依据

- 阿里云百炼 OpenAI-compatible Chat Completions 文档包含图像输入与视频输入示例，视频示例使用 content part 的 `type: "video"` 或视觉理解文档中的 `video_url` 形态。
- 阿里云视觉理解文档说明：OpenAI 兼容 / DashScope HTTP 方式下，较大视频推荐使用公网 URL，小于 7MB 的视频可使用 Base64 编码。
- OpenAI 官方文档的 Files API 与 file inputs 不能等同于百炼控制台的视频附件能力；本 demo 以百炼多模态 Chat Completions 形态为准。
