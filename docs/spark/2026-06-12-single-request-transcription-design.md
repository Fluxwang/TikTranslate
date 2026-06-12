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

**无需改动。** 现有接口支持完整音频 Blob，`startOffset=0` 时行为完全正确。

## 数据流（改动后）

```
用户点击"开始识别"
  → video.play() + recorder.start()（录制全程）
  → 视频播放完毕
  → finalizePlayback() → stopRecorder(true)
  → recorder.stop() → ondataavailable（完整 Blob）
  → sendAudioChunk(blob, 0) → POST /api/transcribe
  → 返回所有 segments，一次性渲染字幕
  → transcribePending 归零 → phase: 'recognized'
  → startAnalysis()
```

## 状态机

`phase` 流转不变：

```
idle → parsing → loaded → recognizing → recognized → (analyzing → done)
```

`recognizing` 阶段视频播放期间：字幕列表为空，显示现有"识别中..."进度动画，无变化。

## 约束与风险

| 项目 | 评估 |
|------|------|
| 音频大小 | TikTok 视频通常 1–3 分钟，webm/opus 约 32 kbps，3 分钟 ≈ 720 KB，远低于 25 MB 限制 |
| 后端超时 | `maxDuration = 60`，单次完整音频 Whisper 响应通常 5–15s，安全 |
| UX | 播放期间无字幕，已确认可接受 |

## 不在范围内

- 超长视频（> 10 分钟）的分段优化
- 播放中途的字幕预览
- 后端接口变更
