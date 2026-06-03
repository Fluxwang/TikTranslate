# TikTranslate

> 粘贴一个 TikTok 链接，实时获取双语字幕，并由 AI 分析达人销售话术。

专为中国跨境电商运营设计 —— 再也不用靠猜来看懂西语达人在说什么。

---

## 截图

### 主界面

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/c29a7b59dd94c217df2b7f58f634fd7fa2b888c32e43a6066f2f0db9e4043a86.png)

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/39565c786da8aea68c17a73246f1013f37a8bcbd7a2a9c7302c234c244456084.png)



### 字幕识别中

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/d9b4049c49688d7605e3c1160b4bb7103556c151b9134cac64f85cb41902a8ac.png)

### AI 分析结果

![](https://wangzhrbuckets.s3.bitiful.net/picture/2026/06/c54393ea4c3186224dad3d25037ffda2453e881568055216fbbeccbcfc922eec.png)

---

## 功能特性

- **TikTok 解析** — 粘贴分享链接，自动解析视频地址，无需手动下载
- **实时双语字幕** — 视频播放时同步生成西语原文 + 中文翻译，覆盖在视频画面上
- **字幕列表 & 跳转** — 中间栏展示所有字幕，点击任意一条直接跳转到对应时间点
- **AI 话术分析** — 转录完成后自动分析：
  - 核心卖点提取（标签形式）
  - 内容评分：说服力 / 钩子强度 / 爆款潜力（0–100 分）
  - 话术摘要
- **追问 AI** — 基于字幕全文和分析结果，支持多轮对话追问（例如"这个达人用了什么情绪化话术？"）
- **密码保护** — 通过 `AUTH_TOKEN` 设置访问门槛，适合内部团队使用
- **明暗主题** — 支持一键切换深色 / 浅色模式

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 16 + React 19 |
| 样式 | Tailwind CSS v4 |
| 语言 | TypeScript |
| 视频解析 | [TikHub API](https://tikhub.io) |
| 语音转录 | Whisper（通过 OpenRouter，也可换成 Groq） |
| AI 分析 | 任意 OpenAI 兼容接口（默认 DeepSeek） |
| 认证 | JWT（`jose`） |
| 包管理 | pnpm |

---

## 快速开始

### 前置要求

- Node.js 18+
- pnpm
- TikHub API Key（用于解析 TikTok 视频）
- OpenRouter API Key（用于 Whisper 转录）
- 任意 OpenAI 兼容 API（用于 AI 分析，推荐 DeepSeek）

### 安装

```bash
git clone https://github.com/pseudowang/tiktranslate.git
cd tiktranslate
pnpm install
```

### 配置环境变量

复制示例文件并填入你的 API Key：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
# TikHub — 解析 TikTok 视频地址
TIKHUB_API_KEY=your_tikhub_key

# OpenRouter — Whisper 转录 + 翻译
OPENROUTER_API_KEY=your_openrouter_key
WHISPER_BASE_URL=https://openrouter.ai/api/v1
WHISPER_MODEL=openai/gpt-4o-mini-transcribe

# AI 分析（任意 OpenAI 兼容接口）
ANALYSIS_API_KEY=your_analysis_key
ANALYSIS_BASE_URL=https://api.deepseek.com
ANALYSIS_MODEL=deepseek-v4-flash

# 访问密码（用户登录时输入此 token）
AUTH_TOKEN=your_password

# JWT 签名密钥（至少 32 位随机字符串）
JWT_SECRET=your_32_char_secret_here_change_me

# 可选：填入后，在 URL 框输入 test1 可直接加载固定测试视频
TEST1_VIDEO_URL=
```

### 启动开发服务器

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，用 `AUTH_TOKEN` 中设置的密码登录即可。

---

## 使用方式

1. **登录** — 输入你在 `AUTH_TOKEN` 中设置的密码
2. **粘贴链接** — 在顶栏输入框粘贴 TikTok 分享链接，点击解析
3. **选择原始语言** — 默认西语（`es`），也可切换为其他语言
4. **开始识别** — 点击"开始识别"，视频自动播放并开始捕获音频
5. **查看字幕** — 视频画面上有实时双语字幕，中间栏可查看完整字幕列表并点击跳转
6. **AI 分析** — 识别完成后自动触发分析，右侧面板展示卖点、评分与摘要
7. **追问** — 在右侧面板底部输入框向 AI 提问

---

## 架构说明

```
tiktranslate/
├── app/
│   ├── api/
│   │   ├── auth/route.ts        # 密码验证，返回 JWT
│   │   ├── tikhub/route.ts      # 代理 TikHub，解析 TikTok 视频 URL
│   │   ├── transcribe/route.ts  # 代理 Whisper，每 15s 音频块调用两次（转录+翻译）
│   │   ├── analyze/route.ts     # 代理 AI 分析接口，返回结构化 JSON
│   │   └── chat/route.ts        # 多轮追问接口
│   ├── login/page.tsx           # 登录页
│   └── page.tsx                 # 主应用页面
├── components/
│   ├── VideoPanel.tsx           # 视频播放器 + 字幕覆盖层
│   ├── SubtitlePanel.tsx        # 字幕列表 + 跳转
│   └── AnalysisPanel.tsx        # AI 分析 + 追问对话
└── lib/
    └── auth.ts                  # JWT 工具函数
```

**数据流：**

```
粘贴链接 → /api/tikhub → 获取 CDN 视频 URL
    ↓
视频播放 → 每 15s 捕获音频 → /api/transcribe
    ↓（Whisper 转录 + 翻译，合并为双语字幕）
字幕列表更新 + 视频覆盖层实时显示
    ↓（视频播放结束后）
/api/analyze → AI 返回卖点 / 评分 / 摘要
    ↓
用户可在右侧面板追问 → /api/chat（携带完整字幕上下文）
```

> API Key 仅在服务端使用，永远不会暴露给浏览器。

---

## 生产部署

```bash
pnpm build
pnpm start
```

也可一键部署到 Vercel，记得在项目设置中填入所有环境变量。

---

## 本地化 & 扩展

- **换语言**：将 `sourceLang` 从 `es`（西语）改为其他 BCP-47 语言代码即可（如 `en`、`pt`）
- **换 AI 模型**：修改 `ANALYSIS_BASE_URL` + `ANALYSIS_MODEL` 可接入任意 OpenAI 兼容接口（如 OpenAI、Claude、Gemini 等）
- **换转录服务**：修改 `WHISPER_BASE_URL` + `WHISPER_MODEL` 可切换到 Groq 或其他 Whisper 兼容接口

---

## License

MIT
