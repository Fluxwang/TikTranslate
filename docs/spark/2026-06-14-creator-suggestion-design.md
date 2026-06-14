# 达人建议 AI 生成 — 设计文档

**日期：** 2026-06-14  
**状态：** 待实现

---

## 背景与目标

用户（国内电商运营）分析同类产品的爆款 TikTok 视频，提取"为什么这个视频会爆"的核心经验，再将这些经验整理成**内容指导信**，发给刚收到产品的新达人，帮助新达人复刻爆款成功路径。

**当前问题：** Tab 4（达人建议）是纯前端模板拼接（`lib/analysis.ts` 的 `buildCreatorSuggestion()`），生成内容与视频分析结果毫无关联，每次输出都是固定套话。

**目标：** 接入真实 AI，基于爆款视频的分析结果（钩子话术、视频结构、卖点、模板）生成个性化的拍摄建议信。

---

## 使用场景

1. 用户分析一个**同类产品爆款视频**，得到分析结果（hooks / videoStructure / templates / sellingPoints / summary）
2. 用户在产品设置页选好产品（自动猫砂盆 / 工业水冷扇）
3. 点击「Generate creator suggestion」，AI 生成一封**内容指导信**
4. 用户复制后发给**刚寄出产品的新达人**，让她参考爆款经验拍视频

指导信的核心逻辑：**爆款视频为什么成功 → 翻译成新达人可操作的拍摄建议 → 每条建议附带具体例句**

---

## 方案

独立 `SUGGEST_*` 环境变量，与分析模型完全解耦，可独立选用更擅长写文案的模型。

---

## 新增环境变量

```
SUGGEST_API_KEY=      # 文案生成模型的 API Key
SUGGEST_BASE_URL=     # OpenAI-compatible base URL
SUGGEST_MODEL=        # 模型名称（如 claude-3-5-sonnet / gpt-4o）
```

---

## 新增 TypeScript 类型（`lib/types.ts`）

```ts
export interface SuggestAnalysis {
  hooks: HookItem[];
  videoStructure: VideoStructureSegment[];
  templates: ScriptTemplate[];
  sellingPoints: string[];
  summary: string;
}

export interface SuggestResponse {
  en: string;
  es: string;
  zh: string;
}
```

---

## 后端：`POST /api/suggest`

### 鉴权

与其他路由一致，调用 `verifyJWT(req)`，失败返回 `401`。

### 请求体

```ts
{
  product: Product;       // 来自 lib/types.ts
  analysis: SuggestAnalysis;
}
```

`sourceLang` 已从项目删除，不包含。LLM 可从 `hooks.src` 内容自行判断视频原语言。

### 响应

```json
{
  "en": "Honey~ 🥰 Just wanted to say — your content style is really solid...",
  "es": "Cariño~ 🥰 Solo quería decirte — tu estilo de contenido es realmente bueno...",
  "zh": "亲爱的~ 🥰 想说一声——你的内容风格真的很扎实..."
}
```

一次请求生成 3 种语言版本，前端无需重复请求即可切换。

### 数据截断

不截断，全量发送 analysis 数据。功能手动触发、低频，质量优先于 token 成本。

### Prompt（英文）

```
You are an experienced TikTok e-commerce content consultant.

The user has analyzed a viral product video and extracted the following insights.
Note: some fields may be empty if the analysis could not extract them — do your best with what's available.

[Video Summary]
{summary}

[Successful Hook Lines]
{hooks — each with timestamp, original text, Chinese translation, hook type tag}

[Video Narrative Structure]
{videoStructure — each segment's function and why it worked}

[Reusable Script Templates]
{templates — reusable script patterns with placeholder slots}

[Core Selling Points from Video]
{sellingPoints}

[Product to Promote]
Name: {product.name}
Target audience: {product.audience}
Key selling points: {product.sellingPoints}
Use scenario: {product.scene}

Based on the viral video analysis above, write a content coaching message to send to a NEW creator who just received this product.

Requirements:
- Warm and friendly tone — like advice from a friend, not instructions from a client
- Open with one genuine compliment about the creator
- Give 5–6 specific, actionable filming tips
- For each tip, briefly explain WHY it works (rooted in the viral video's success)
- For each tip, include one concrete example line the creator could actually say
- Example lines should tie to the product's real use scenario ({product.scene})
- Close with encouragement for the creator to make it their own

Output ONLY valid JSON with exactly these three fields — no Markdown, no code block:
{
  "en": "English version (for English/international creators)",
  "es": "Spanish version (for Spanish-speaking creators)",
  "zh": "Chinese version (for operator reference)"
}
```

### 响应校验

三个字段（`en` / `es` / `zh`）必须全部是非空字符串，否则返回 `500 suggestion_parse_failed`。不做宽松兜底。

### 错误处理

| 情况 | 响应 |
|------|------|
| JWT 无效 | 401 unauthorized |
| 请求体缺少必填字段 | 400 missing_fields |
| LLM 返回非 JSON 或字段缺失/为空 | 500 suggestion_parse_failed |
| LLM 请求失败 | 502 llm_failed |

---

## 前端：`CreatorTab` 改动

### 按钮可用条件

`Generate creator suggestion` 按钮仅在 `analysisPhase === 'done'` 时可点击。  
未完成分析时 disable，tooltip 显示「请先完成视频分析」。

### 状态

```ts
const [results, setResults] = useState<SuggestResponse | null>(null);
const [lang, setLang] = useState<'en' | 'es' | 'zh'>('en');
const [error, setError] = useState(false);
```

- `lang` 在重新 Generate 后**保持当前选中语言**（不重置回 EN）
- 点击 Generate 后立刻清空 `results`（`setResults(null)`），显示骨架屏 loading

### UI

```
[Ready to send]      [EN] [ES] [ZH]   [Copy]
```

- 3 个语言 pill，切换即时生效，不重新请求
- Copy 复制当前选中语言的内容
- `Ready to send` 标签永远显示英文，不跟语言切换变化

### 错误状态

请求失败时，在结果区域显示红色错误卡片：「生成失败，请重试」  
用户可再次点击 Generate 按钮重试。

### 回调 prop 模式（与 `onSend` 一致）

`authedFetch` 定义在 `page.tsx`（`useCallback`），子组件不可直接调用。

**`AnalysisPanel` 新增 prop：**
```ts
onSuggest: (product: Product, analysis: SuggestAnalysis) => Promise<SuggestResponse>;
```

**`page.tsx` 实现：**
```ts
const onSuggest = useCallback(async (product, analysis) => {
  const res = await authedFetch('/api/suggest', {
    method: 'POST',
    body: JSON.stringify({ product, analysis }),
  });
  if (!res.ok) throw new Error('suggest failed');
  return await res.json();
}, [authedFetch]);
```

**`CreatorTab` 的 `onGenerate`：**
```ts
setLoading(true);
setResults(null);   // 立刻清空旧结果
setError(false);
try {
  const json = await onSuggest(product, {
    hooks: data.hooks,
    videoStructure: data.videoStructure,
    templates: data.templates,
    sellingPoints: data.sellingPoints.map(sp => sp.text),
    summary: data.summary,
  });
  setResults(json);
} catch {
  setError(true);
} finally {
  setLoading(false);
}
```

### 需要删除的代码

- `lib/analysis.ts` 中的 `buildCreatorSuggestion()` 函数

---

## 数据流总结

```
analysisPhase === 'done' → Generate 按钮可点
  → 立刻清空旧 results，显示 skeleton loading
  → POST /api/suggest { product, analysis }
  → 后端用 SUGGEST_* 调用 LLM（英文 Prompt）
  → LLM 输出 { en, es, zh }，后端严格校验三字段
  → 前端存入 results，保持当前 lang 选择
  → 失败 → 结果区显示红色错误卡片
  → Copy 复制当前语言版本
```

---

## 不在本次范围内

- **话术模板自动填入**：Tab 3 的 `[方括号]` 占位符自动替换为产品信息
- **产品信息云端同步**：当前 localStorage 存储不变
- **流式输出**：三语言顺序生成体验割裂，使用一次性返回
