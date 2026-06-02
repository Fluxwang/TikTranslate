# TikTranslate — 完整项目 Brief

---

## 一、项目概述

**项目名称**：TikTranslate
**项目类型**：Web 应用（全栈，Next.js）
**目标用户**：TikTok Shop 电商从业者、品牌方、达人运营
**核心价值**：快速理解西语 TikTok 达人视频内容，降低语言壁垒，辅助选品和合作决策

**一句话描述**：粘贴 TikTok 链接，自动播放视频、生成双语字幕、AI 分析达人话术。

---

## 二、背景与痛点

TikTok Shop 在拉美市场（墨西哥、巴西、哥伦比亚等）快速增长，大量优质达人使用西语创作内容。国内电商从业者在筛选达人、分析竞品视频时面临：

- 看不懂西语视频说了什么
- 需要手动下载视频再用其他工具翻译，流程繁琐
- 无法快速判断达人的话术质量和带货能力
- 缺乏结构化的视频内容分析工具

---

## 三、版本规划

| 版本 | 功能范围 |
| ---- | -------- |
| V1   | 视频解析 + 播放、实时双语字幕、AI 内容分析、追问 AI、密码认证 |
| V2   | 字幕导出（.srt / .vtt） |
| V3   | 关键帧截图多模态分析 |

---

## 四、核心功能（V1）

### 4.1 视频解析与播放

- 用户粘贴 TikTok 视频链接（支持完整链接和分享短链）
- 调用 TikHub API 解析视频，获取无水印视频播放地址
- `url_list` 包含多条 CDN 地址，按顺序 try，容错处理
- 注意：CDN URL 有时效，不可缓存，需立即使用
- 在内置播放器中直接播放，无需下载

### 4.2 实时双语字幕

- 视频播放同时，Web Audio API + MediaRecorder 实时捕获音频
- **每 15 秒**切一个音频片段发给 Whisper（近实时，避免短片段断句）
- 两次 Whisper 调用：
  - 第一次：`task: transcribe, language: es` → 西语原文 + 时间戳
  - 第二次：`task: translate` → 英文翻译文本
- **时间戳策略**：只使用第一次调用（西语）返回的时间戳，英文翻译按 segment 顺序一一映射，不使用翻译的时间戳
- Whisper 返回 `verbose_json`，每个 segment 约 2-5 秒（句子级粒度）
- 字幕叠加显示在视频画面底部（上西语 / 下英文）
- 中栏同步生成完整字幕列表，支持点击跳转

### 4.3 AI 内容分析（V1 纯文本）

- 字幕识别完成后，将完整字幕文本发给 Claude 分析
- V1 不含关键帧截图，V3 再加多模态
- Claude 返回固定结构 JSON：

```json
{
  "selling_points": ["轻薄", "大吸力", "性价比"],
  "scores": {
    "persuasion": 82,
    "hook": 75,
    "viral_potential": 90
  },
  "summary": "开头用痛点钩子..."
}
```

- 前端直接解析 JSON 渲染三个卡片

### 4.4 追问 AI

- 用户针对视频内容自由提问
- 上下文 = 完整字幕文本 + 分析 JSON 结果
- 回复显示在输入框下方

### 4.5 密码认证

- 访问网站时显示密码输入页
- 密码在服务器端校验（Next.js API Route）
- 验证通过后 token 存 `localStorage`，后续每次 API 请求带上 token
- 防止 API Key 被外部滥用

---

## 五、技术架构

### 5.1 整体架构

```
Next.js 全栈应用（前端 + API Routes）
前端：React + TypeScript（桌面端，不做移动端适配）
后端：Next.js API Routes 作为代理层，API Key 存服务器端
部署：服务器 npm start + Caddy 反代（或 Docker + Caddy）
```

### 5.2 技术栈

| 层级       | 技术选型                      | 说明                                         |
| ---------- | ----------------------------- | -------------------------------------------- |
| 框架       | Next.js + TypeScript          | 前后端一体，API Routes 做代理                |
| 视频播放   | 原生 `<video>` 标签           | 直接加载 TikTok CDN 链接，crossOrigin="anonymous" |
| 音频捕获   | Web Audio API + MediaRecorder | 从 video 元素实时捕获，15 秒一片段           |
| 字幕识别   | OpenRouter API（openai/whisper-large-v3）  | 西语识别 + 英文翻译，通过 WHISPER_BASE_URL 配置      |
| AI 分析    | OpenAI 兼容接口（通过 ANALYSIS_BASE_URL 配置）| V1 纯文本字幕分析，返回结构化 JSON           |
| 视频解析   | TikHub API                    | 通过 TikTok 链接获取视频播放地址             |
| 部署       | Caddy + pm2 / Docker          | 自动 HTTPS，沿用已有部署方式                 |

### 5.3 数据流

```
用户粘贴 TikTok 链接
        ↓
前端 → Next.js API Route /api/tikhub → TikHub API
        ↓ 返回 play_addr_h264.url_list（按顺序 try）
<video> 加载视频并播放
        ↓
Web Audio API 捕获音频（每 15 秒一片段）
        ↓
前端 → Next.js API Route /api/transcribe → Groq Whisper
  → 第一次调用：西语原文 + 时间戳（verbose_json）
  → 第二次调用：英文翻译文本（verbose_json，时间戳丢弃）
  → 两次结果按 segment 顺序合并，统一用西语时间戳
        ↓
字幕实时渲染（视频叠加 + 中栏列表同步更新）
        ↓
识别完成后 → 前端 → /api/analyze → Claude API
        ↓
分析 JSON 填充右栏三个卡片
```

### 5.4 关键 API

**TikHub API**

```
GET https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_one_video_by_share_url
    ?share_url={TikTok链接}
Header: Authorization: Bearer {TIKHUB_API_KEY}

返回字段（按顺序 try）：
data.aweme_detail.video.play_addr_h264.url_list[0]
data.aweme_detail.video.play_addr_h264.url_list[1]
data.aweme_detail.video.play_addr_h264.url_list[2]
```

**Whisper API（OpenRouter）**

```
POST {WHISPER_BASE_URL}/audio/transcriptions
  默认：https://openrouter.ai/api/v1/audio/transcriptions
Header: Authorization: Bearer {OPENROUTER_API_KEY}

第一次（原文）：
  model: openai/whisper-large-v3
  task: transcribe
  language: es
  response_format: verbose_json  ← segments 含时间戳，作为最终时间戳

第二次（翻译）：
  model: openai/whisper-large-v3
  task: translate
  response_format: verbose_json  ← 只取文本，时间戳丢弃
```

**AI 分析 API（OpenAI 兼容接口）**

```
POST {ANALYSIS_BASE_URL}/chat/completions
Header: Authorization: Bearer {ANALYSIS_API_KEY}

  输入：完整字幕文本（V1 纯文本，V3 加关键帧图片）
  输出：JSON 格式（selling_points / scores / summary）
```

### 5.5 API Keys 配置

所有 Key 存在服务器端 `.env.local`，不暴露给前端：

```
TIKHUB_API_KEY=           # TikHub — fetches TikTok video URLs
OPENROUTER_API_KEY=       # OpenRouter — Whisper transcription + translation
WHISPER_BASE_URL=https://openrouter.ai/api/v1   # Whisper API base URL
ANALYSIS_API_KEY=         # AI analysis — OpenAI-compatible key
ANALYSIS_BASE_URL=        # AI analysis base URL (e.g. https://api.openai.com/v1)
AUTH_TOKEN=               # Password gate token
```

---

## 六、前端布局

### 6.1 页面结构

```
┌──────────────────────────────────────────────────────┐
│  导航栏：Logo + 链接输入框 + 解析按钮                   │
├─────────────────┬──────────────┬──────────────────────┤
│  左栏（5fr）     │  中栏（4fr） │  右栏（5fr）           │
│  视频播放器      │  字幕列表    │  AI 分析               │
│  + 字幕叠加      │             │                       │
└─────────────────┴──────────────┴──────────────────────┘
```

纯桌面端布局，不做移动端响应式适配。

### 6.2 三栏详细说明

**左栏 — 视频播放器**

- 黑色背景视频区（9:16 竖屏）
- 字幕叠加在画面底部：上西语（半透明黑底）/ 下英文（深黑底加粗）
- 底部：播放/暂停 + 进度条 + 时间 + 音量

**中栏 — 字幕列表**

- 每条字幕：时间戳 + 西语原文 + 英文翻译
- 当前播放句高亮（背景色 + 左侧 2px 竖线）
- 其他句子 opacity 0.4
- 点击任意句跳转视频到对应时间
- 底部：识别状态指示（绿点 + 文字）

**右栏 — AI 分析**

- 核心卖点（pill 标签组）
- 内容评分（说服力 / 钩子强度 / 爆款潜力，进度条形式，0-100）
- 话术摘要（纯文本）
- 追问 AI 输入框（上下文 = 完整字幕 + 分析结果，回复显示在输入框下方）

---

## 七、关键交互流程

### 主流程

```
1. 用户粘贴链接 → 点击解析
2. 解析按钮 loading → TikHub 返回视频地址（url_list 容错 try）
3. 视频自动加载并播放
4. 同时开始捕获音频，每 15 秒发送一片段给 Whisper
5. 字幕实时填充（中栏列表 + 左栏视频叠加同步更新）
6. 视频播放时中栏字幕自动滚动跟随
7. 识别完成 → 自动触发 AI 分析
8. AI 分析结果依次填充右栏三个卡片
```

### 次要交互

- 点击字幕 → 视频跳转
- 追问 AI → 发送带完整字幕 + 分析结果上下文的问题
- 暂停视频 → 字幕叠加保持当前句不变

---

## 八、页面状态

| 状态       | 表现                                       |
| ---------- | ------------------------------------------ |
| 未认证     | 显示密码输入页，验证通过后进入主界面       |
| 初始空状态 | 三栏显示占位提示，引导粘贴链接             |
| 解析中     | 按钮 loading，输入框禁用                   |
| 视频就绪   | 播放器显示封面，等待用户点击播放           |
| 识别中     | 中栏实时填充字幕，底部绿点动画             |
| 识别完成   | 底部显示"识别完成 ✓"，触发 AI 分析         |
| AI 分析中  | 右栏卡片显示 skeleton 骨架屏               |
| 全部完成   | 三栏数据全部就位，可正常交互               |
| 错误状态   | 链接无效 / API 失败 → 对应区域显示错误提示 |

---

## 九、后续可扩展功能

| 版本 | 功能       | 说明                             |
| ---- | ---------- | -------------------------------- |
| V2   | 字幕导出   | 导出 .srt / .vtt，含西语和英文版 |
| V3   | 关键帧分析 | Canvas 截帧 + base64 发给 Claude，多模态分析 |
| 未来 | 多语言支持 | 除西语外支持其他语言识别         |
| 未来 | 批量分析   | 一次粘贴多个链接批量处理         |
| 未来 | 历史记录   | 本地存储已分析过的视频           |
| 未来 | 达人对比   | 多个视频 AI 分析结果横向对比     |
| 未来 | 脚本生成   | 根据分析结果一键生成类似话术脚本 |

---

## 十、项目文件结构

```
tiktranslate/
├── app/
│   ├── page.tsx              ← 主页面（含密码认证判断）
│   ├── login/page.tsx        ← 密码认证页
│   ├── layout.tsx
│   └── api/
│       ├── auth/route.ts     ← 密码校验，返回 token
│       ├── tikhub/route.ts   ← TikHub 代理
│       ├── transcribe/route.ts ← Groq Whisper 代理
│       └── analyze/route.ts  ← Claude 分析代理
├── components/
│   ├── VideoPlayer.tsx       ← 视频播放器 + 字幕叠加
│   ├── SubtitleList.tsx      ← 中栏字幕列表
│   └── AnalysisPanel.tsx     ← 右栏 AI 分析
├── lib/
│   ├── audio.ts              ← 音频捕获与分片逻辑
│   ├── subtitle.ts           ← 字幕合并与时间戳对齐
│   └── types.ts              ← 共用 TypeScript 类型
├── .env.local                ← API Keys（不入 git）
└── public/
```
