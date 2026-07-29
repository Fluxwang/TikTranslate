# TikTranslate 阅读指南

给第一次接触这个项目的人（包括几个月后的你自己）用的读码路线图。**按顺序读完，你会对整个项目建立完整、准确的心智模型。**

预计耗时：快速通读约 1.5 小时；每一站的「动手」都做完约 4 小时。

> 本文描述的是**当前代码的真实状态**。仓库里的 `brief.md`、`README.md`、`docs/spark/*` 是更早期的设计文档，部分文件名和接口已经过时——**遇到冲突一律以代码为准**。
>
> 各模块的设计取舍写在**文件头注释**里，不在这份文档里重复。这份文档只负责告诉你「先读什么、为什么这么读、读完该懂什么」。

---

## 这个项目是干什么的

给国内跨境电商运营用的工具。粘一个 TikTok 链接进来，它会：

1. 解析出视频地址并播放
2. 播放过程中实时把西语口播转成**双语字幕**（原文 + 中文）
3. 识别完成后，把整段字幕（可能连同视频画面）交给 AI，产出**带货话术分析**
4. 用户可以基于分析结果继续追问，或让 AI 生成一段**发给达人的拍摄建议**

技术栈：Next.js 16（App Router）+ React 19 + TypeScript + Tailwind v4，无状态管理库，无数据库。

---

## 全局地图

先建立方位感，不用细看：

```
app/
  page.tsx            主页面：持有状态机 + 接线 + 布局（209 行）
  login/page.tsx      登录页
  layout.tsx          根布局
  globals.css         全部样式（1851 行，最后再看）
  api/                7 个后端路由，全是第三方服务的代理层
hooks/                10 个领域 hook —— 前端逻辑的主体
components/
  TopBar / VideoPanel / SubtitlePanel     左中两列 + 顶栏
  analysis/                               右列：AI 分析栏（12 个文件）
lib/                  共享类型、纯函数、服务端工具（含 4 个测试文件）
```

一句话概括架构：**`hooks/` 装前端逻辑，`app/api/` 装服务端代理，`lib/` 装两边都能用的纯函数，`components/` 只负责渲染。**

---

## 阅读路线（8 站）

### 第 1 站 · 数据模型 —— `lib/types.ts`（129 行）

**为什么先读它**：这个项目的复杂度集中在「数据在各层之间变形」——后端返回的粗糙 JSON → 前端补全 → 5 个 Tab 消费。先把数据的形状装进脑子，后面所有代码都会好读很多。

重点看四组类型：

| 类型 | 含义 |
|---|---|
| `Phase` vs `AnalysisPhase` | **两套状态机**。前者管「解析 + 识别」，后者管「AI 分析」。文件开头的注释解释了为什么分开 |
| `Subtitle` | 全项目流转最频繁的结构：`{ t, es, zh }` |
| `AnalyzeResponse` | `/api/analyze` 的原始返回 |
| `AnalysisData` | 前端 5 个 Tab 实际消费的**补全后**结构 |

✅ **读完你该能回答**：`AnalyzeResponse` 和 `AnalysisData` 为什么是两个类型而不是一个？

---

### 第 2 站 · 热身：认证链路（最短的一条完整支线）

按这个顺序读，20 分钟就能走完一条从前端到后端的完整链路：

1. `lib/auth.ts`（37 行）—— JWT 签发与校验。注意 payload 是**空的**，注释解释了为什么
2. `app/api/auth/route.ts` —— 校验密码，按 IP 限流
3. `hooks/useAuthedFetch.ts`（56 行）—— 前端怎么带 token、401 怎么处理
4. `app/login/page.tsx` —— 登录页

✅ **读完你该能回答**：为什么 `authedFetch` 在 401 时**仍然把失败的 Response 返回**给调用方，而不是抛错？（答案在函数注释里）

---

### 第 3 站 · 主流程的骨架 —— `app/page.tsx`（209 行）

现在读主页面。它**只做三件事**：持有 `phase` 状态机、把各 hook 接起来、摆布局。

先读文件头的流程注释，然后重点看三处：

- **30-51 行**：10 个 hook 是怎么被组装起来的
- **111-115 行**：`recognizing → recognized` 的判定。三个条件缺一不可，注释说明了各自的必要性
- **142-149 行**：`activeIdx` —— 当前该高亮哪条字幕

这一站不要深挖任何一个 hook 的内部，只建立「谁负责什么」的印象。

✅ **读完你该能画出**：从「用户粘链接」到「AI 分析出结果」，数据依次经过哪些 hook？

---

### 第 4 站 · 前端逻辑主体 —— `hooks/`（按依赖顺序）

这是整个项目**信息密度最高**的地方，慢慢读。顺序是从简单到复杂：

| # | 文件 | 行数 | 看点 |
|---|---|---|---|
| 1 | `useTheme.ts` | 26 | 最小的完整 hook，热身 |
| 2 | `useProducts.ts` | 26 | 惰性初始化 + localStorage 持久化 |
| 3 | `useSuggest.ts` | 28 | 最简单的请求封装 |
| 4 | `useVideoSource.ts` | 81 | 链接解析 + **多 CDN 候选降级**（CDN 地址是短时效的） |
| 5 | `useChat.ts` | 86 | 多轮追问。注意它为什么按 `index` 更新而不是更新最后一条 |
| 6 | `useAnalysis.ts` | 118 | AI 分析。注意 `phaseRef` 为什么存在 |
| 7 | **`useAudioRecorder.ts`** | 167 | **MediaRecorder 生命周期，不含任何业务概念** |
| 8 | `useTranscription.ts` | 102 | 建在 7 之上，管分片上传与字幕合并 |
| 9 | `useVideoPlayback.ts` | 213 | 播放状态与交互，通过回调与 8 联动 |

**7 和 8 的分层是这个项目最值得学的设计**：`useAudioRecorder` 刻意不知道字幕、不知道识别阶段、不发任何请求，它只管录音，产出的分片通过 `onChunk` 回调交出去；业务逻辑全在上一层的 `useTranscription`。这条边界的好处是——如果要加「用麦克风录制」的功能，只需换掉 stream 来源，上层一行不用改。

读这九个文件时，**特别留意三个反复出现的模式**（每处都有注释解释）：

- **latest ref**（`useAudioRecorder.ts:40`、`useVideoPlayback.ts:56`）—— 回调注册一次但需要读最新值时用
- **ref 镜像 state**（`useAnalysis.ts:37`、`useVideoPlayback.ts:52`）—— 需要在同一个事件循环内同步判断时用
- **`useMemo` 稳定返回值**（每个 hook 结尾）—— 让调用方能安全地把整个对象写进依赖数组

✅ **读完你该能回答**：为什么 `useTranscription` 用**计数器**而不是布尔值来标记「转写中」？

---

### 第 5 站 · 服务端代理层 —— `app/api/`

7 个路由，全部是第三方服务的代理。**它们存在的首要理由是密钥永远不下发到浏览器**。

按这个顺序读：

**1. `tikhub/route.ts`（145 行）—— 最简单的代理**
把 TikTok 分享链接换成 CDN 视频地址。注意 `resolveDebugVideoAlias`：输入 `test1` 会走一个固定视频，省 API 配额。

**2. `chat/route.ts`（87 行）—— 最薄的一个**
多轮追问。服务端**不存会话**，历史完全由客户端每次带上来。

**3. `transcribe/route.ts`（378 行）—— 第一个深水区**

这是全项目算法密度最高的文件。它做两件事：

- **音频 → 带时间戳的字幕**。核心是分句：Whisper 返回的是**词级**时间戳，要自己决定在哪里断句。看 `shouldEndSubtitle`（60-70 行）的四条启发式规则，按优先级排列。
- **三层降级**（`getSegments`，171-188 行）：词级时间戳 → 段级时间戳 → 整段纯文本按字符比例估算时间点。上游返回什么形状都能出字幕。
- **翻译也是三层降级**（`translateSegments`，226 行起）：一次性批量翻译 → 整体重试 → 逐条单独翻译兜底。

**4. `analyze/route.ts`（234 行）—— 编排层**

只剩编排逻辑，三件事分给了三个模块（见第 6 站）。核心是**两段式降级**：优先「视频 + 字幕」多模态分析，任何一步失败都静默退回「纯字幕」再试一次，两次都失败才报错。

特别注意 189-196 行：判断「模型是否真的看到了视频」以**模型自己的自述**为输入，但最终判定权在服务端——不能因为「我们发了视频过去」就认定它看到了。

**5. `suggest/route.ts`（242 行）—— 达人建议生成**
注意它的一整套类型守卫（`isProduct` / `isSuggestAnalysis` / …）：请求体来自客户端，逐字段校验。

**6. `tmp-video/[id]/route.ts`（136 行）—— 唯一不走 JWT 的路由**
读文件里 84-85 行的注释：因为 `<video>` 标签发起的请求**带不了自定义请求头**，所以改用 URL 里的一次性 token 校验。还实现了 HTTP Range 请求（206 部分内容）。

**7. `demo-hint/route.ts`（4 行）—— 扫一眼就行**

✅ **读完你该能回答**：为什么不让前端直接调 OpenRouter，非要在中间加一层？（至少说出三个理由）

---

### 第 6 站 · 共享层 —— `lib/`

**先读测试，再读实现。** 测试用例是最好的规格说明书——它们直接告诉你每个函数在各种脏输入下应该有什么行为。

```bash
pnpm test          # 66 个用例，应该全绿
```

| 文件 | 行数 | 看点 |
|---|---|---|
| `format.ts` + `.test.ts` | 44 | 最简单的纯函数，从这里开始 |
| `api-error.ts` / `env.ts` / `log.ts` | 33/16/14 | 三个小工具。`log.ts` 是日志脱敏，注释解释了为什么必须有 |
| **`url-guard.ts`** + `.test.ts` | 81 | **SSRF 防护**。读文件头注释：防的是什么、以及**防不住什么** |
| **`analysis-schema.ts`** + `.test.ts` | 223 | **第二个深水区**：LLM 脏输出的兜底规范化 |
| `analysis-prompt.ts` | 132 | prompt 构造。措辞是调出来的，改动前先看注释 |
| `analysis.ts` + `.test.ts` | 115 | 前端适配层 `adaptAnalysis` |
| `tmpVideo.ts` | 408 | **第三个深水区**（见下） |

**`analysis-schema.ts` 为什么重要**：这一层的上游是大模型，它的输出是「大概率符合约定、但随时可能不符合」的 JSON——字段缺失、类型不对、数值越界、外面裹一层解释文字，都真实发生过。所有 `normalize*` 函数保证**无论输入多脏，输出一定是声明的形状**，因此前端不需要到处判空。

配套的 38 个测试用例把每一条降级路径都覆盖了，读测试比读实现快。

**`lib/tmpVideo.ts` 单独说**（408 行，建议最后读）：
多模态模型需要一个**公网可访问的视频 URL**，而 TikTok 的 CDN 地址不能直接给它。这个模块负责：下载视频到服务端临时目录 → 生成带一次性 token 的公网 URL → 分析结束后延迟删除。

重点看：
- `fetchDownloadableVideo`（147 行）—— 手动跟随重定向，**每一跳都要重新做 SSRF 校验**
- `writeResponseBodyToFile`（103 行）—— 流式写入 + 体积上限，防止超大文件打爆磁盘
- `readTmpVideoMeta`（333 行）—— `id` 会拼进文件路径，注释解释了为什么必须限定成固定长度十六进制（路径穿越）
- TTL 与延迟删除是**两个独立机制**，文件开头注释说明了不能合并的原因

✅ **读完你该能回答**：`url-guard.ts` 挡不住哪一类攻击？为什么没有修？

---

### 第 7 站 · 组件层 —— `components/`

组件层**几乎没有逻辑**，读起来很快。

**左中两列：**
- `TopBar.tsx`（102 行）—— URL 输入、解析按钮、主题切换
- `VideoPanel.tsx`（228 行）—— `<video>` + 字幕浮层 + 自绘进度条。注意 164-175 行：字幕切换时靠**改 key** 来重放淡入动画
- `SubtitlePanel.tsx`（212 行）—— 字幕列表 + 点击跳转 + 自动滚动到当前行

**右列 AI 分析栏：`components/analysis/`**（12 个文件），按依赖方向自下而上读：

```
shared/Icon.tsx          SVG 图标集。注意结尾的 satisfies 用法
shared/Markdown.tsx      react-markdown 封装。两处覆盖都是安全考量，读注释
shared/Placeholders.tsx  骨架屏 / 空态
creatorReducer.ts        达人建议的状态机（纯函数，最值得读的一个）
tabs/*.tsx               5 个 Tab，互不相关，任意顺序
settings/*.tsx           产品设置
AnalysisPanel.tsx        容器：Tab 导航 + 空态/失败态分发
```

`creatorReducer.ts` 值得单独看：它是全项目唯一用 `useReducer` 的地方，注释解释了为什么这里该用而别处不该用——关键不是「字段多」，而是这些字段之间有**联动规则**。

✅ **读完你该能回答**：为什么 5 个 Tab 拆成 5 个文件是合理的，而不是「为拆而拆」？

---

### 第 8 站 · 样式 —— `app/globals.css`（1851 行）

放最后，因为它跟逻辑几乎无关。全部样式集中在这一个文件里，用 CSS 变量做明暗主题（`useTheme` 只改 `<html data-theme>`，不触发 React 重渲染）。

**不用通读**，需要改某块 UI 时再来查对应的 class 名即可。

---

## 走一遍完整数据流（复习用）

读完上面 8 站后，自己顺着走一遍，卡住就回去翻：

```
用户粘链接
  → useVideoSource.parse()  →  POST /api/tikhub  →  TikHub  →  videoUrls[]
  → <video> 加载（失败则 fallbackToNextUrl 换下一个 CDN 候选）
  → 用户点「开始识别」：video.play() + useAudioRecorder.start()
  → 播放中每次「暂停 / 结束」触发一次 ondataavailable，产出一段音频
      → useTranscription.sendChunk()  →  POST /api/transcribe
          → Whisper 转写（词级时间戳）→ shouldEndSubtitle 分句
          → translateSegments 批量翻译（三层降级）
          → 返回 { segments: Subtitle[] }
      → 合并进 subtitles 并按时间戳重排
  → 三个条件同时成立 → phase 变为 recognized
  → 用户点「开始分析」：useAnalysis.start()  →  POST /api/analyze
      → selectVideoInput：下载视频到临时目录，生成带 token 的公网 URL
      → 优先「视频 + 字幕」多模态分析；失败则静默降级为纯字幕重试
      → normalizeAnalysis 把脏 JSON 整形成 AnalyzeResponse
      → adaptAnalysis 补全成 AnalysisData
  → 5 个 Tab 渲染
  → 用户追问 → useChat.send() → POST /api/chat（每次重传完整上下文）
  → 用户生成达人建议 → useSuggest → POST /api/suggest
```

---

## 想动手时

```bash
pnpm dev            # localhost:3000
pnpm test           # 66 个单测，改 lib/ 后必跑
pnpm lint           # 应该零 error 零 warning
pnpm build          # 类型检查也在这一步
pnpm format         # Prettier，提交前跑
pnpm doctor         # React 诊断（当前还有既有问题未清，见下）
```

需要 `.env.local`，字段清单见 `.env.example` 和 `CLAUDE.md` 的「Environment Variables」一节。

**改动前必读**：`AGENTS.md` 里的代码风格与测试约定。特别是测试那一节——**只测 `lib/` 下的纯函数是有意的边界，不是遗漏**，组件和 hooks 不写单测的理由写在里面。

---

## 已知问题（读代码时会撞到，先打个预防针）

1. **`VideoPanel.tsx` / `SubtitlePanel.tsx` 里各有一份本地的 `Phase` / `Subtitle` 类型副本**，没有从 `lib/types.ts` import。文件头有注释标明，改字段时要手动同步——这是历史遗留，该修。
2. **`pnpm doctor` 还有约 60 个问题**，主要是既有组件里的「数组索引当 key」和 `<button>` 缺 `type`。上一次重构只处理了三条主干上的问题，这批没动。
3. **`brief.md` 与 `docs/spark/*` 已过期**，是早期设计文档，保留作为决策记录，不要当作当前实现的说明。
4. 更完整的清单（含字幕去重、SSRF 的 DNS rebinding 局限等）在重构记录里。

---

## 这个项目里最值得学的三处

如果时间有限，只看这三个地方：

1. **`hooks/useAudioRecorder.ts` + `useTranscription.ts` 的分层** —— 怎么把一个浏览器 API 封装成不含业务的一层，业务建在它之上
2. **`lib/analysis-schema.ts` + 它的 38 个测试** —— 怎么消费一个「不守约定的上游」（大模型），以及怎么用测试把每条降级路径钉住
3. **`app/api/transcribe/route.ts` 的三层降级** —— 同一个目标（出字幕），上游给什么形状的数据都能兜住
