# AI 追问面板 Markdown 渲染支持

**日期：** 2026-06-04  
**状态：** 已批准，待实现

---

## 背景

`AnalysisPanel` 的"追问 AI"对话框（`AskBox` 组件）目前将 AI 回复渲染为纯文本，`**粗体**`、列表、代码块等 Markdown 语法不会被解析，直接以字符显示。本方案为该区域添加完整 Markdown 渲染能力。

---

## 目标

- AI 回复中的 Markdown 语法（粗体、斜体、列表、代码块、表格、删除线等）自动渲染为对应 HTML 元素
- XSS 安全：不使用 `dangerouslySetInnerHTML`
- 样式与现有深色/浅色主题一致，复用已有 CSS 变量

---

## 方案

使用 **`react-markdown` + `remark-gfm`**（方案 A）：

- `react-markdown`：React 生态标准 Markdown 渲染器，内部走 React 元素树，天然防 XSS
- `remark-gfm`：GFM 扩展语法支持（表格、删除线、任务列表、自动链接等）
- 包体积：~20KB gzip，无额外运行时依赖

---

## 改动范围

**仅修改以下三处，其他文件不动：**

1. `package.json` — 新增两个依赖
2. `components/AnalysisPanel.tsx` — `AskBox` 内替换渲染方式
3. `app/globals.css` — 追加 `.ask-msg.a` 作用域下的 Markdown 元素样式

---

## 实现细节

### 1. 依赖安装

```bash
pnpm add react-markdown remark-gfm
```

### 2. AnalysisPanel.tsx

在文件顶部添加导入：

```ts
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
```

在 `AskBox` 组件内，将当前第 73 行：

```jsx
{m.a == null
  ? <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  : m.a}
```

改为：

```jsx
{m.a == null
  ? <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
  : <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.a}</ReactMarkdown>}
```

流式输出时（`m.a` 逐字追加），`ReactMarkdown` 每次 re-render 重新解析当前字符串；未闭合的 Markdown 语法会被忽略，不产生乱码。

### 3. globals.css — Markdown 元素样式

在 `.ask-msg.a .who { ... }` 规则之后追加，全部限定在 `.ask-msg.a` 作用域内：

| 元素 | 样式策略 |
|------|----------|
| `p` | `margin: 0`，段落间距用 `+ p { margin-top: 6px }` |
| `strong` | `font-weight: 600`，继承颜色 |
| `em` | `font-style: italic`，继承颜色 |
| 行内 `code` | `font-family: var(--font-mono)`，`font-size: 10px`，淡背景（`--color-background-tertiary`），小圆角 |
| `pre` | 深背景，`padding: 8px 10px`，`border-radius: var(--border-radius-sm)`，`overflow-x: auto` |
| `pre code` | 重置行内 code 的背景和 padding |
| `ul / ol` | `padding-left: 16px`，`margin: 4px 0` |
| `li` | `margin: 2px 0` |
| `blockquote` | 左边框 `2px solid var(--color-border-secondary)`，`padding-left: 8px`，颜色降调至 `var(--color-text-tertiary)` |
| `a` | `color: var(--accent)`，hover 加下划线 |
| `table` | `border-collapse: collapse`，`font-size: 10px` |
| `th / td` | `border: 1px solid var(--color-border-tertiary)`，`padding: 3px 6px` |

---

## 不在本次范围内

- 代码块语法高亮（需额外引入 `react-syntax-highlighter`，独立需求）
- `summary` 字段、卖点 pill、评分区域的 Markdown 渲染（当前 AI 返回值为纯文本，无需处理）
- 移动端响应式（项目整体不支持移动端）
