# TikTranslate 项目阅读指南

给第一次接触这个项目的人（包括未来的你）用的读码路线图。按顺序读完，你会对整个项目有一个完整、准确的心智模型。

> ⚠️ **本文已过期（写于 2026-07-23）**，之后项目经历了一次结构性重构，本指南描述的文件划分大部分已不成立：
>
> - `app/page.tsx` 的逻辑已拆入 `hooks/`（10 个领域 hook）
> - `components/AnalysisPanel.tsx` 已拆为 `components/analysis/` 目录
> - `app/api/analyze/route.ts` 的 prompt 与规范化逻辑已抽到 `lib/analysis-prompt.ts` / `lib/analysis-schema.ts`
> - `lib/demo-data.ts` 已删除（零引用死代码）
> - 新增 `lib/api-error.ts` / `env.ts` / `log.ts` / `url-guard.ts` / `format.ts` 及 Vitest 测试
>
> **遇到冲突一律以代码为准。** 各模块的职责与设计取舍现在写在文件头注释里。

---

## 0. 五分钟建立全局认知

按顺序读这三份，不用细读，扫一遍建立框架：

1. `CLAUDE.md` — 项目一句话定位：分析 TikTok 达人视频，AI 分析分五个 Tab（概念 / 视频结构 / 爆点话术 / 达人建议 / 追问AI）
2. `AGENTS.md` — 目录约定、代码风格、提交规范
3. `brief.md` — 最初的产品设计稿（V1 范围、三栏布局、关键交互流程）。**注意**：文件路径章节（第十节）里的文件名如 `VideoPlayer.tsx`/`SubtitleList.tsx`、以及"Claude API 分析"等描述已经过时，实际见第 8 节对照表。

看完这三份，你应该能回答："这个项目是干什么的、给谁用的、大致技术栈是什么"。

---

## 1. 数据模型先行：`lib/types.ts`（120 行）

**为什么先读这个**：这个项目的复杂度主要体现在数据在"后端粗JSON → 前端补全 → 5个Tab渲染"之间的层层适配，先理解类型就能理解整个数据流的形状。

重点关注：
- `Phase` vs `AnalysisPhase`（第 3-7 行有注释解释两套状态机的分工：一个管"解析+识别"，一个管"AI分析"）
- `AnalyzeResponse`（后端 `/api/analyze` 的原始返回，很多字段是 `?` 可选——因为后端还没实现）
- `AnalysisData`（前端 5 个 Tab 实际消费的"补全后"完整结构）
- `SuggestAnalysis` / `SuggestResponse`（专门给"达人建议"生成接口用，字段和 `AnalysisData` 很像但不是一回事，注释里有说明）
- `AnalysisMeta.videoFallbackReason`（一长串枚举，对应视频多模态分析失败时的降级原因——先扫一眼，第 7 节细讲）

---

## 2. 认证链路（最简单的一条支线，用来热身）

1. `lib/auth.ts`（36 行）— JWT 签发/校验（`jose`）
2. `app/api/auth/route.ts`（69 行）— 校验 `AUTH_TOKEN`，按 IP 做内存限流
3. `app/login/page.tsx` — 登录页
4. `app/api/demo-hint/route.ts`（4 行）— 演示环境下把 `DEMO_AUTH_TOKEN` 暴露出来做提示，纯辅助功能

看完这一支，你会理解为什么其他所有 API 路由开头都会调用 `verifyJWT(req)`。

---

## 3. 主页面骨架：`app/page.tsx`（511 行）

这是全项目的"胶水层"，把所有组件和 API 串起来。**建议先看结构，不逐行读**：

```bash
grep -n "^function\|^export\|const \[" app/page.tsx
```

关注这几块：
- 第 41-59 行：所有 `useState`，对照 `lib/types.ts` 里的类型，能猜出每个状态对应哪个 Tab / 哪个阶段
- 第 76 行 `authedFetch`：所有请求的统一封装（带 token，401 跳转登录）
- 第 91-133 行 `stopRecorder` / `sendAudioChunk`：音频分片发送到 `/api/transcribe` 的逻辑
- 第 135-210 行 `startRecorder`：15 秒一片段的 `MediaRecorder` 逻辑 + 调 `/api/tikhub`
- 第 259 行 `finalizePlayback`：识别完成后的收尾
- 第 353 行 `startAnalysis`：触发 `/api/analyze`
- 第 412 行：追问 AI 调 `/api/chat`
- 第 429 行 `onSuggest`：达人建议调 `/api/suggest`

读完这个文件，你会看到五条 API 调用（tikhub / transcribe / analyze / chat / suggest）分别在什么时机被触发——这是整个数据流的骨架。

---

## 4. 视频解析：`app/api/tikhub/route.ts`（133 行）

- 把 TikTok 分享链接换成 CDN 播放地址（`videoUrls`，注意有效期短，不可缓存）
- `test1` 调试别名走 `TEST1_VIDEO_URL`，跳过真实 TikHub 调用——本地开发时会常用到

---

## 5. 播放与字幕组件

按这个顺序看，从"最直觉"到"最有状态机复杂度"：

1. `components/TopBar.tsx`（68 行）— 链接输入、语言选择、开始按钮、主题切换
2. `components/VideoPanel.tsx`（175 行）— `<video crossOrigin="anonymous">` + 双语字幕叠加
3. `components/SubtitlePanel.tsx`（161 行）— 中栏字幕列表，点击跳转，识别进度指示

看完后配合 `docs/spark/2026-06-02-video-proxy-fallback.md` 理解一个坑：如果 TikTok CDN 不返回 CORS 头，`crossOrigin="anonymous"` 会导致音频捕获失败（字幕永远是空的）——这也是第 7 节 tmp-video 代理支线存在的原因之一。

---

## 6. 转录链路：`app/api/transcribe/route.ts`（372 行）

- 每 15 秒一个音频片段，调用两次 Whisper：一次 `transcribe`（保留时间戳）、一次 `translate`（丢时间戳，按 segment 顺序对齐）
- 配合 `docs/spark/2026-06-12-single-request-transcription-design.md` 理解为什么设计成这样（以及是否有过"合并成一次请求"的尝试/结论）

---

## 7. AI 分析核心：这是全项目最重的一块，分三层读

### 7.1 后端：`app/api/analyze/route.ts`（531 行，全项目最大的路由文件）
- 输入完整字幕文本，调用 `ANALYSIS_BASE_URL`（文本分析）和/或 `ANALYSIS_VIDEO_BASE_URL`（Qwen 多模态视频分析，見 `.env.example` 里的 `ANALYSIS_VIDEO_*`）
- 重点找："视频分析走通" vs "降级为纯文本分析" 的分支逻辑，会用到 `lib/tmpVideo.ts`

### 7.2 视频代理支线：`lib/tmpVideo.ts`（426 行）+ `app/api/tmp-video/[id]/route.ts`
- 把 TikTok CDN 视频下载到服务器临时目录（TTL 30 分钟），生成一个短期可访问的 URL 给 Qwen 视频模型用
- 配合两份设计文档读：
  - `docs/spark/2026-06-10-ai-analysis-video-backend-design.md`
  - `docs/spark/2026-06-10-qwen-video-r2-demo-design.md`
- `AnalysisMeta.videoFallbackReason`（`lib/types.ts` 里那一长串枚举）就是这条链路每一步可能失败的原因，读代码时对照着找每个枚举值在 `tmpVideo.ts` / `analyze/route.ts` 里的触发点

### 7.3 前端适配层：`lib/analysis.ts`（107 行）
- `adaptAnalysis()`：把后端粗糙的 `AnalyzeResponse` 补全成前端要的完整 `AnalysisData`（没返回的字段用占位/计算值填充）
- 产品设置的 `localStorage` 持久化（`loadProducts`/`saveProducts`）
- 达人建议的本地模板生成器（在真正调用 `/api/suggest` 之前，本地兜底话术怎么拼出来的）
- 读完这个文件之后**必须**对照 `docs/aiAnalysis-backend-todo.md`——这份文档精确列出了"UI 已经支持、但后端还没真正返回"的字段，是理解当前项目成熟度的关键

### 7.4 前端渲染：`components/AnalysisPanel.tsx`（1001 行，全项目最大的组件）
按 Tab 拆开读，每个 Tab 是一个独立的顶层函数：
- `OverviewTab`（273 行起）— 概览/爆点/评分
- `StructureTab`（343 行起）— 视频结构
- `ScriptsTab`（401 行起）— 爆点话术
- `CreatorTab`（453 行起，篇幅最大）— 达人建议，配合 `creatorReducer`（249 行起）理解生成/编辑/发送话术的状态机
- `AskTab`（612 行起）— 追问 AI
- `SettingsPage`（813 行起）— 产品设置页
- 最底部 `export default function AnalysisPanel`（845 行起）— 5 个 Tab 的容器 + 路由

---

## 8. 追问 AI：`app/api/chat/route.ts`（92 行）

多轮对话，上下文 = 完整字幕 + 分析结果 JSON。读完后回头看 `docs/spark/2026-06-04-analysis-panel-markdown-design.md`，理解为什么追问回复要支持 Markdown 渲染（`stripMarkdown` 在 `AnalysisPanel.tsx` 第 40 行，是反过来在别处剥除 Markdown 用的，注意别混淆用途）。

---

## 9. 达人建议生成：`app/api/suggest/route.ts`（248 行）

配合 `docs/spark/2026-06-14-creator-suggestion-design.md`（这是这条功能的原始设计文档，CLAUDE.md 里提到的"达人建议"功能核心实现）。理解它和 `lib/analysis.ts` 里本地模板兜底逻辑的关系：本地模板是兜底/占位，这个路由是真正调 AI 生成的版本。

---

## 10. 边角料（可选，非核心路径）

- `lib/demo-data.ts`（41 行）— 演示数据
- `app/api/demo-hint/route.ts` — 已在第 2 节提过

---

## 建议的实操验证方式

读完每一段代码后，跑一遍真实流程验证理解：

```bash
pnpm dev
```

1. 用 `AUTH_TOKEN` 登录
2. URL 输入框填 `test1`（如果配置了 `TEST1_VIDEO_URL`）触发调试视频，跳过真实 TikHub 调用
3. 点击"开始识别"，观察 Network 面板里 `/api/transcribe` 每 15 秒一次的调用
4. 识别完成后观察 `/api/analyze` 请求和响应，对照 `lib/analysis.ts` 的 `adaptAnalysis()` 看字段是怎么被填充的
5. 切到"达人建议" Tab，触发 `/api/suggest`，对照 `CreatorTab` 的状态机

---

## 文档 vs 当前代码 对照表（哪些历史文档已经过时）

| 文档 | 状态 | 说明 |
|---|---|---|
| `brief.md` 第十节文件结构 | **过时** | 写的是 `VideoPlayer.tsx`/`SubtitleList.tsx`/`audio.ts`/`subtitle.ts`，实际是 `VideoPanel.tsx`/`SubtitlePanel.tsx`，且没有独立的 `audio.ts`/`subtitle.ts` 文件（逻辑内联在 `app/page.tsx`）|
| `brief.md` 5.4 节 "AI 分析 API" | **过时** | 写的是固定调 "Claude API"，实际是任意 OpenAI 兼容接口（`ANALYSIS_BASE_URL`），且已扩展出 `ANALYSIS_VIDEO_*` 多模态分析 |
| `README.md` Architecture 一节 | **不完整** | 只列了 5 个 API 路由，实际还有 `app/api/suggest`、`app/api/tmp-video/[id]`、`app/api/demo-hint` |
| `docs/aiAnalysis-backend-todo.md` | **需要核对** | 写于 2026-06-10，达人建议功能（`/api/suggest`）之后已经实现，部分"待办"可能已完成，读的时候要和 `lib/analysis.ts`/`app/api/suggest/route.ts` 的当前实现交叉验证，而不要直接当作当前状态 |
| `docs/spark/*` 系列 | **历史设计快照**，非当前状态 | 都是某个功能落地前的设计讨论，帮助理解"为什么这么设计"，但具体实现细节以代码为准 |

---

## 一页纸速查：文件行数与阅读优先级

| 文件 | 行数 | 优先级 |
|---|---|---|
| `lib/types.ts` | 120 | ★★★★★ 必读，且要第一个读 |
| `app/page.tsx` | 511 | ★★★★★ 骨架 |
| `components/AnalysisPanel.tsx` | 1001 | ★★★★★ 最大组件，按 Tab 拆读 |
| `app/api/analyze/route.ts` | 531 | ★★★★☆ 最大路由，含视频分析降级逻辑 |
| `lib/tmpVideo.ts` | 426 | ★★★☆☆ 视频代理支线，可稍后读 |
| `app/api/transcribe/route.ts` | 372 | ★★★★☆ |
| `app/api/suggest/route.ts` | 248 | ★★★☆☆ |
| `components/VideoPanel.tsx` | 175 | ★★★☆☆ |
| `lib/analysis.ts` | 107 | ★★★★★ 体积小但是理解数据流的关键 |
| `components/SubtitlePanel.tsx` | 161 | ★★★☆☆ |
| `app/api/tikhub/route.ts` | 133 | ★★★☆☆ |
| `app/api/chat/route.ts` | 92 | ★★☆☆☆ |
| `components/TopBar.tsx` | 68 | ★★☆☆☆ |
| `app/api/auth/route.ts` | 69 | ★★☆☆☆ |
| `lib/auth.ts` | 36 | ★★☆☆☆ |
| `lib/demo-data.ts` | 41 | ★☆☆☆☆ |
| `app/api/demo-hint/route.ts` | 4 | ★☆☆☆☆ |
