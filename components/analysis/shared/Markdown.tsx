import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 渲染 AI 返回的 Markdown 时的组件覆盖。
 *
 * 这两条都是安全考量，不是样式偏好：
 * - a：强制 target="_blank" + rel="noopener noreferrer"。没有 noopener 时，
 *   被打开的页面可以通过 window.opener 反向操作我们这个标签页。
 * - img：直接不渲染。模型输出里的图片地址不可信，渲染它等于让第三方
 *   拿到用户 IP，也可能是追踪像素。
 */
const MD_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: () => null,
};

/** 渲染一段来自 AI 的 Markdown 文本。 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
