# AI 分析侧边栏 — 前后端对接 TODO

**日期：** 2026-06-10
**背景：** `components/AnalysisPanel.tsx` 已按 Claude Design 设计稿重构为 5 Tab（概览 / 视频结构 / 爆点话术 / 达人建议 / 追问 AI）+ 产品设置页。
本文档列出前端**已经支持**、但**后端尚未返回**的数据字段，以及需要新增的接口，供后续对接。

前端的兼容/占位逻辑全部在 `lib/analysis.ts` 的 `adaptAnalysis()` 中：缺失字段会用计算值或空数组兜底，
**后端按本文档逐步补全字段即可，无需前端配合改动**。

---

## 一、`/api/analyze` 现状 vs 目标

### 现状（`app/api/analyze/route.ts` 当前 prompt 返回）

```json
{
  "sellingPoints": ["卖点1", "卖点2"],
  "scores": [
    { "dim": "说服力", "val": 8.7, "pct": 87 },
    { "dim": "钩子强度", "val": 9.2, "pct": 92 },
    { "dim": "爆款潜力", "val": 8.1, "pct": 81 }
  ],
  "summary": "...",
  "suggestedQuestions": ["追问1", "追问2", "追问3"]
}
```

这部分字段前端已直接使用（Tab 1 的核心卖点 / 内容评分 / 追问 AI 的引导问题），**无需改动**。

### 目标（设计稿中的完整 `analysis` 结构）

```json
{
  "overall": { "score": 8.7, "label": "高复制价值" },
  "duration": { "label": "短视频最优区间" },

  "sellingPoints": ["20000Pa 大吸力", "重量 < 1.5kg", "续航 45 分钟", "LED 照明灯头", "可旋转刷头"],

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
      "time": "0:00–0:05",
      "desc": "用「我家不再扫地」这个反常识断言开场，先抛结果制造悬念，逼观众停下来想「为什么」，再揭晓答案。",
      "tags": ["好奇心缺口", "结果前置"]
    }
  ],

  "hooks": [
    {
      "time": "0:00",
      "src": "Bueno, dejen que les enseñe por qué ya no barro mi casa.",
      "zh": "好，让我告诉你们为什么我家再也不扫地了。",
      "tag": "⚡ 开场钩子 — 好奇心缺口"
    }
  ],

  "templates": [
    { "type": "开场模板", "text": "说真的，自从用了 [产品]，我家就再也没 [旧的麻烦做法] 过了。" }
  ],

  "summary": "...",
  "suggestedQuestions": ["追问1", "追问2", "追问3"]
}
```

---

## 二、需要后端补充的字段

> 类型定义见 `lib/types.ts` 的 `AnalyzeResponse` / `VideoStructureSegment` / `HookItem` / `ScriptTemplate`。
> 颜色（`color`）字段**不需要后端返回**，前端按数组下标循环分配（紫/绿/橙/红/蓝/粉）。

### 1. `overall: { score: number; label: string }`

Tab 1 左侧卡片「综合爆款评分」。

- `score`：0-10 综合评分（建议为 `scores` 各维度平均值，或由 LLM 单独给出）
- `label`：评分解读文案，如「高复制价值」/「有复制价值」/「可参考」

**未返回时的占位行为：** 前端用 `scores` 平均值计算 `score`，按阈值（≥8.5/≥7/其他）生成 `label`。

### 2. `duration: { label: string }`

Tab 1 右侧卡片「视频时长」副标题，如「短视频最优区间」/「中等时长」/「长视频，建议精简」。
时长数值本身（大字）由前端用视频自身 `durationSec` 计算，无需后端返回。

**未返回时的占位行为：** 前端按 `durationSec` 阈值（≤60s / ≤180s / 更长）生成固定文案。

### 3. `scores` 扩展到 5 维

当前只返回 3 维（说服力/钩子强度/爆款潜力），设计稿要求 5 维，新增：

- `转化引导`（conversion guide）
- `视觉演示`（visual demo）

数组顺序即前端配色顺序（紫/绿/橙/粉/蓝），**建议按上面 JSON 示例的顺序返回**。

**未返回时的占位行为：** 前端正常渲染现有的 3 维，不会报错。

### 4. `videoStructure: VideoStructureSegment[]`

Tab 2「视频叙事结构拆解」，对应字段：

```ts
{ title: string; time: string; desc: string; tags: string[] }
```

- `title`：段落标题，如「强钩子开场」
- `time`：时间区间文案，如「0:00–0:05」
- `desc`：该段落做了什么、为什么有效
- `tags`：1-3 个标签，如 `["好奇心缺口", "结果前置"]`

建议 4-6 段，覆盖完整视频时间线。

**未返回时的占位行为：** Tab 2 显示 `EmptyTab` 占位说明（"暂无视频结构数据，需后端返回 videoStructure 字段"）。

### 5. `hooks: HookItem[]`

Tab 3「高效钩子话术提取」，对应字段：

```ts
{ time: string; src: string; zh: string; tag: string }
```

- `time`：时间戳，如「0:00」
- `src`：原文（视频原语言，对应 `sourceLang`）
- `zh`：中文翻译
- `tag`：钩子类型标签，建议带 emoji 前缀，如「⚡ 开场钩子 — 好奇心缺口」

建议 4-6 条，按时间顺序排列。

### 6. `templates: ScriptTemplate[]`

Tab 3「可复用话术模板」，对应字段：

```ts
{ type: string; text: string }
```

- `type`：模板类型，如「开场模板」「演示模板」「结果模板」「收口模板」
- `text`：模板文字，用 `[方括号]` 标注可替换的填空位（前端会高亮渲染 `[xxx]`）

建议 4 个模板，覆盖开场/演示/结果/收口四个阶段。

**`hooks` 和 `templates` 都未返回时的占位行为：** Tab 3 显示 `EmptyTab` 占位说明。

---

## 三、Tab 4「达人建议」— 当前实现 & 未来 `/api/suggest`

**当前实现（已上线，前端纯模板拼接，`lib/analysis.ts` 的 `buildCreatorSuggestion()`）：**

- 用户在 Tab 4 选择一个产品（来自产品设置页，目前存 `localStorage`）
- 点击「Generate creator suggestion」后，前端用产品信息（`name`/`audience`/`sellingPoints`/`scene`）+ `analysisData.hooks[0]`
  拼接成一段固定模板的英文建议文案，**不调用任何后端接口**
- 结果展示在「Ready to send」卡片中，支持一键 Copy

**未来可选：新增 `POST /api/suggest`，由 LLM 实时生成更自然的建议**

```jsonc
// Request
{
  "product": { "id": "p1", "name": "...", "audience": "...", "sellingPoints": "...", "scene": "..." },
  "analysis": { /* /api/analyze 的完整返回，含 hooks/videoStructure/summary 等 */ },
  "sourceLang": "es"
}

// Response 200
{ "suggestion": "Hi! That opening — ... 🙌" }
```

- Prompt 设计参考设计稿「生成逻辑」：`视频分析结果（钩子/演示/情感/CTA）+ 产品卖点信息 → 英文软性建议`
- 风格要求：友好、温暖、尊重达人创作空间；开头夸奖，中间 4-5 条编号建议，结尾鼓励
- 接入时只需替换 `components/AnalysisPanel.tsx` 中 `CreatorTab` 的 `onGenerate`：
  把 `window.setTimeout(() => setResult(buildCreatorSuggestion(product, data)), 500)`
  改为调用 `/api/suggest` 并 `setResult(data.suggestion)`，其余 UI（loading/Copy）逻辑不变。

---

## 四、产品设置持久化（可选）

当前产品数据（Tab 4 下拉框 + 设置页）存于浏览器 `localStorage`（key: `tt_products`），
默认值为设计稿预设的两个产品（自动猫砂盆 / 工业水冷扇），见 `lib/analysis.ts` 的 `DEFAULT_PRODUCTS`。

如需跨设备同步，可新增：

- `GET /api/products` — 返回 `Product[]`
- `PUT /api/products` — 保存 `Product[]`

接入时替换 `lib/analysis.ts` 的 `loadProducts`/`saveProducts` 为对应的 fetch 调用即可，
`components/AnalysisPanel.tsx` 与 `app/page.tsx` 均通过这两个函数间接读写，无需改动调用方。

---

## 五、前端兼容性说明

- 所有新字段均为 **可选（optional）**，`adaptAnalysis()` 在缺失时使用计算值或空数组兜底，
  现有 3 维评分 + sellingPoints + summary + suggestedQuestions 的链路完全不受影响。
- 后端可以**逐字段**补充上线（如先加 `videoStructure`，再加 `hooks`/`templates`），
  每加一个字段，对应 Tab 即从「占位说明」切换为正常展示，无需前端发版。
- 「追问 AI」（Tab 5）沿用现有 `/api/chat` 接口，未受本次改动影响。
