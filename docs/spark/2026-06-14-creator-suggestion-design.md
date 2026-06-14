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

## 方案选择

使用**方案 B：独立 `SUGGEST_*` 环境变量**，与分析模型完全解耦，可独立选用更擅长写文案的模型。

---

## 新增环境变量

```
SUGGEST_API_KEY=      # 文案生成模型的 API Key
SUGGEST_BASE_URL=     # OpenAI-compatible base URL
SUGGEST_MODEL=        # 模型名称（如 claude-3-5-sonnet / gpt-4o）
```

---

## 后端：`POST /api/suggest`

### 鉴权

与其他路由一致，调用 `verifyJWT(req)`，失败返回 `401`。

### 请求体

```ts
{
  product: {
    name: string;
    audience: string;
    sellingPoints: string;
    scene: string;
  };
  analysis: {
    hooks: HookItem[];          // 爆款视频的钩子话术（时间、原文、中译、类型标签）
    videoStructure: VideoStructureSegment[];  // 视频叙事结构（段落、时间、描述、标签）
    templates: ScriptTemplate[];  // 爆款话术模板（类型、模板文本）
    sellingPoints: string[];    // 视频卖点列表
    summary: string;            // 视频整体摘要
  };
}
```

**注意：** `sourceLang` 已从项目中删除，不包含在请求体中。LLM 可从 `hooks.src` 内容自行判断视频原语言。

### 响应

```json
{
  "en": "Honey~ 🥰 Just wanted to say — your content style is really solid...",
  "es": "Cariño~ 🥰 Solo quería decirte — tu estilo de contenido es realmente bueno...",
  "zh": "亲爱的~ 🥰 想说一声——你的内容风格真的很扎实..."
}
```

一次请求生成 3 种语言版本，前端无需重复请求即可切换。

### Prompt 设计

```
你是一位经验丰富的 TikTok 电商内容顾问。
用户分析了一条爆款带货视频，提取了以下信息：

[视频摘要]
{summary}

[成功钩子话术]
{hooks - 每条带时间戳、原文、中文翻译、类型标签}

[视频叙事结构]
{videoStructure - 各段落的功能和为什么有效}

[爆款话术模板]
{templates - 可复用的话术结构}

[核心卖点]
{sellingPoints}

[推广产品]
产品名称：{product.name}
目标受众：{product.audience}
核心卖点：{product.sellingPoints}
使用场景：{product.scene}

请你基于上面的爆款视频分析，生成一封发给新达人的内容指导信。
要求：
- 语气友好温暖，像朋友给建议，不是甲方下指令
- 开头先夸达人（一句真诚的话）
- 给出 5-6 条具体可操作的拍摄建议
- 每条建议说明"为什么"（来自爆款视频的成功经验）
- 每条建议附带一句具体的例句（达人可以直接参考说的话）
- 例句要结合产品具体场景（如 {product.scene}）
- 结尾鼓励达人发挥自己的风格

请用 JSON 格式输出，包含三个字段：
{
  "en": "英文版本（发给英语/国际达人）",
  "es": "西班牙语版本（发给西语达人）",
  "zh": "中文版本（用于对照参考）"
}
只输出 JSON，不要 Markdown 或代码块。
```

### 错误处理

| 情况 | 响应 |
|------|------|
| JWT 无效 | 401 unauthorized |
| 请求体缺少必填字段 | 400 missing_fields |
| LLM 返回非 JSON | 500 suggestion_parse_failed |
| LLM 请求失败 | 502 llm_failed |

---

## 前端：`CreatorTab` 改动

### 状态变化

```ts
// 旧
const [result, setResult] = useState("");

// 新
const [results, setResults] = useState<{ en: string; es: string; zh: string } | null>(null);
const [lang, setLang] = useState<'en' | 'es' | 'zh'>('en');
```

### UI 变化

在 Copy 按钮左侧加 3 个语言切换 pill（小号，不抢焦点）：

```
[Ready to send]      [EN] [ES] [ZH]   [Copy]
```

- 默认选中 EN
- 切换语言即时切换显示内容，无需重新请求
- Copy 按钮复制当前选中语言的内容

### 回调 prop 模式（与 `onSend` 一致）

`authedFetch` 定义在 `page.tsx` 中（`useCallback`），无法在子组件直接调用。延续现有 `onSend` 模式：

**`AnalysisPanel` 新增 prop：**
```ts
onSuggest: (product: Product, analysis: SuggestAnalysis) => Promise<{ en: string; es: string; zh: string }>;
```

**`page.tsx` 实现：**
```ts
const onSuggest = useCallback(async (product, analysis) => {
  const res = await authedFetch('/api/suggest', {
    method: 'POST',
    body: JSON.stringify({ product, analysis }),
  });
  return await res.json();
}, [authedFetch]);
```

**`CreatorTab` 的 `onGenerate` 改动：**
```ts
// 旧
window.setTimeout(() => {
  setResult(buildCreatorSuggestion(product, data));
  setLoading(false);
}, 500);

// 新
try {
  const json = await onSuggest(product, {
    hooks: data.hooks,
    videoStructure: data.videoStructure,
    templates: data.templates,
    sellingPoints: data.sellingPoints.map(sp => sp.text),
    summary: data.summary,
  });
  setResults(json);
} finally {
  setLoading(false);
}
```

### 需要删除的代码

- `lib/analysis.ts` 中的 `buildCreatorSuggestion()` 函数（第 109-133 行）

---

## 数据流总结

```
用户点击 Generate
  → 前端收集 product + data.analysis（已在内存中，无额外请求）
  → POST /api/suggest
  → 后端用 SUGGEST_* 配置调用 LLM
  → LLM 输出 { en, es, zh }
  → 前端存入 results state
  → 默认显示 EN，用户可切换 ES / ZH
  → Copy 复制当前语言版本
```

---

## 不在本次范围内

- **话术模板自动填入**：Tab 3 的 `[方括号]` 占位符自动替换为产品信息（单独需求）
- **产品信息云端同步**：当前 localStorage 存储不变
- **流式输出**：考虑到3语言顺序生成体验割裂，使用一次性返回，等待期间显示 loading
