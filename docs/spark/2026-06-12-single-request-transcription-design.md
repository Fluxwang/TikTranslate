# 单次请求转录设计

**日期**: 2026-06-12  
**状态**: 已批准

## 背景与目标

当前字幕识别每 15 秒切割一次音频 chunk 并分别发送 Whisper，导致句子在 chunk 边界被截断，上下文失真。

目标：等视频完整播放完毕后，将全程音频作为单个 Blob 一次性发送 `/api/transcribe`，彻底消除上下文截断问题。代价是视频播放期间无实时字幕（已接受）。

## 改动范围

### 前端：`app/page.tsx`

**移除定时切割逻辑**

删除 `startRecorder()` 中的 `setInterval`（当前第 166–174 行）：

```ts
// 删除这段：
recorderTimerRef.current = window.setInterval(() => {
  const recorder = mediaRecorderRef.current;
  const currentVideo = videoRef.current;
  if (!currentVideo || currentVideo.paused || currentVideo.ended || recorder?.state !== 'recording') return;

  recorder.stop();
  mediaRecorderRef.current = null;
  window.setTimeout(startChunkRecorder, 0);
}, 15_000);
```

**移除 `recorderTimerRef`**

`setInterval` 移除后，`recorderTimerRef` 及其相关的 `clearInterval` 调用成为死代码，一并删除：
- 删除 `const recorderTimerRef = useRef<number | null>(null)` 声明
- 删除 `stopRecorder()` 中的 `clearInterval` 分支

**`sendAudioChunk()` 的 `startOffset` 参数**

单次请求时 `startOffset` 始终为 `0`，可将 `form.set('startOffset', ...)` 改为固定传 `'0'`，或保留原样（后端已正确处理 `0`）。推荐保留，不引入额外差异。

### 后端：`app/api/transcribe/route.ts`

**需要两处改动：**

**1. 切换模型**

将 `.env.local` 中的 `WHISPER_MODEL` 改为 `openai/whisper-large-v3-turbo`（通过现有 `OPENROUTER_API_KEY` 调用，约 $0.00067/min，比 `gpt-4o-mini-transcribe` 更便宜且更快）。

**2. 请求参数加 `response_format` 和 `timestamp_granularities`**

在发给 OpenRouter 的请求 body 中加入：

```ts
body: JSON.stringify({
  model: process.env.WHISPER_MODEL ?? 'openai/whisper-large-v3-turbo',
  input_audio: {
    data: await blobToBase64(audio),
    format: getAudioFormat(audio),
  },
  response_format: 'verbose_json',
  timestamp_granularities: ['segment'],
}),
```

`verbose_json` 使 Whisper 返回带 `start` 时间戳的 `segments` 数组，现有 `getSegments()` 已能正确解析。若 OpenRouter 的 JSON body 格式不支持这两个参数（需实测），降级方案为切换到标准 multipart/form-data 格式。

## 数据流（改动后）

```
用户点击"开始识别"
  → video.play() + recorder.start()（录制全程，不切割）
  → 视频播放完毕
  → finalizePlayback() → stopRecorder(true)
  → recorder.stop() → ondataavailable（完整 Blob）
  → sendAudioChunk(blob, 0) → POST /api/transcribe
  → Whisper 返回 verbose_json，含句子级 segments + 时间戳
  → 一次性渲染所有字幕（含点击跳转时间戳）
  → transcribePending 归零 → phase: 'recognized'
  → startAnalysis()
```

## 状态机

`phase` 流转不变：

```
idle → parsing → loaded → recognizing → recognized → (analyzing → done)
```

`recognizing` 阶段视频播放期间：字幕列表为空，显示现有"识别中..."进度动画，视频结束后才批量显示字幕。

## 约束与风险

| 项目 | 评估 |
|------|------|
| 音频大小 | TikTok 视频通常 1–3 分钟，webm/opus 约 32 kbps，3 分钟 ≈ 720 KB，远低于 25 MB 限制 |
| 后端超时 | `maxDuration = 60`，单次完整音频 Whisper-turbo 响应通常 5–15s，安全 |
| timestamp_granularities 兼容性 | OpenRouter JSON body 格式需实测；若不支持，改用 multipart/form-data |
| UX | 播放期间无字幕，已确认可接受 |
| 模型切换 | `WHISPER_MODEL` 环境变量改为 `openai/whisper-large-v3-turbo`，`.env.local` 需手动更新 |

## 不在范围内

- 超长视频（> 10 分钟）的分段优化
- 播放中途的字幕预览
- multipart/form-data 格式迁移（仅在 verbose_json 实测失败时启动）
