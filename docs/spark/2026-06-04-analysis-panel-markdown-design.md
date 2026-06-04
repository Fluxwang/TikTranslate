# AI 追问面板 Markdown 渲染支持

**日期：** 2026-06-04  
**状态：** 已批准，待实现

---

## 背景

`AnalysisPanel` 的"追问 AI"对话框（`AskBox` 组件）目前将 AI 回复渲染为纯文本，`**粗体**`、列表、代码块等 Markdown 语法不会被解析，直接以字符显示。本方案为该区域添加完整 Markdown 渲染能力。

---

## 目标

- AI 回复中的 Markdown 语法（粗体、斜体、标题、列表、代码块、表格、删除线等）自动渲染为对应 HTML 元素
- XSS 安全：不使用 `dangerouslySetInnerHTML`
- 链接在新 tab 打开，保留用户当前视频分析状态
- 图片语法禁用（AI 幻觉输出，不渲染）
- 样式与现有深色/浅色主题一致，复用已有 CSS 变量

---

## 方案

使用 **`react-markdown` + `remark-gfm`**：

- `react-markdown`：React 生态标准 Markdown 渲染器，内部走 React 元素树，天然防 XSS
- `remark-gfm`：GFM 扩展语法支持（表格、删除线、任务列表、自动链接等）
- 包体积：~20KB gzip，无额外运行时依赖

---

## 改动范围

仅修改以下三处，其他文件不动：

1. `package.json` — 新增两个依赖
2. `components/AnalysisPanel.tsx` — `AskBox` 内替换渲染方式及布局
3. `app/globals.css` — 追加 Markdown 元素样式

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

**布局调整：** 原来 `<span class="who">AI</span>` 与文本 inline 排列。引入 `ReactMarkdown` 后输出块级元素（`<p>`、`<ul>` 等），inline + block 混排会碎版。解决方案：`.ask-msg.a` 改为 `flex-direction: column`，"AI" 标签独占一行，Markdown 内容在下方的 `.ask-msg-body` 容器内渲染。

将当前 `ask-msg.a` 的内部结构从：

```jsx
<div className="ask-msg a">
  <span className="who">AI</span>
  {m.a == null ? <span className="spinner" /> : m.a}
</div>
```

改为：

```jsx
<div className="ask-msg a">
  <span className="who">AI</span>
  <div className="ask-msg-body">
    {m.a == null
      ? <span className="spinner" style={{ display: 'inline-block' }} />
      : <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={MD_COMPONENTS}
        >
          {m.a}
        </ReactMarkdown>}
  </div>
</div>
```

`MD_COMPONENTS` 定义在组件文件顶层（模块级常量，无需 `useMemo`）：

```ts
const MD_COMPONENTS = {
  // 链接在新 tab 打开，防止跳走导致视频分析状态丢失
  a: ({ href, children }: React.ComponentPropsWithoutRef<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  // AI 幻觉可能产生图片语法，直接禁用
  img: () => null,
};
```

### 3. globals.css — 样式覆盖

**`.ask-msg.a` 布局改为 flex column：**

```css
.ask-msg.a {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

同时移除 `.ask-msg.a .who` 原有的 `margin-right: 5px`（inline 布局遗留，flex column 下不再需要）。

**Markdown 元素样式**（全部限定在 `.ask-msg-body` 作用域内，不影响其他区域）：

| 元素 | 样式策略 |
|------|----------|
| `p` | `margin: 0`；段落间距用 `p + p { margin-top: 6px }` |
| `h1` | `font-size: 13px; font-weight: 600; margin: 6px 0 2px` |
| `h2` | `font-size: 12px; font-weight: 600; margin: 6px 0 2px` |
| `h3` | `font-size: 11px; font-weight: 600; margin: 4px 0 2px` |
| `strong` | `font-weight: 600`，继承颜色 |
| `em` | `font-style: italic`，继承颜色 |
| 行内 `code` | `font-family: var(--font-mono)`；`font-size: 10px`；背景 `var(--color-background-tertiary)`；`padding: 1px 4px`；`border-radius: 3px` |
| `pre` | 背景 `var(--color-background-tertiary)`；`padding: 8px 10px`；`border-radius: var(--border-radius-sm)`；`overflow-x: auto`；`margin: 4px 0` |
| `pre code` | 重置行内 code 的背景、padding、border-radius |
| `ul / ol` | `padding-left: 16px`；`margin: 4px 0` |
| `li` | `margin: 2px 0` |
| `blockquote` | 左边框 `2px solid var(--color-border-secondary)`；`padding-left: 8px`；颜色 `var(--color-text-tertiary)` |
| `a` | `color: var(--accent)`；hover 加下划线（行为由 `components` prop 控制，CSS 只管颜色） |
| `table` | `border-collapse: collapse`；`font-size: 10px`；`margin: 4px 0` |
| `th / td` | `border: 1px solid var(--color-border-tertiary)`；`padding: 3px 6px` |
| `th` | `font-weight: 600`；背景 `var(--color-background-secondary)` |
| `hr` | `border: none`；`border-top: 1px solid var(--color-border-tertiary)`；`margin: 6px 0` |

---

## 不在本次范围内

- 代码块语法高亮（需额外引入 `react-syntax-highlighter`，独立需求）
- `summary` 字段、卖点 pill、评分区域的 Markdown 渲染（AI 返回纯文本，无需处理）
- 移动端响应式（项目整体不支持移动端）
- 聊天流式输出（当前 `/api/chat` 返回完整 JSON，`m.a` 一次性更新）
