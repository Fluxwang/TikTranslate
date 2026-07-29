// 纯格式化函数，前后端共用（无 DOM、无 React 依赖，因此可以直接单测）。

/**
 * 秒 → `m:ss`。
 *
 * 接受 unknown 而不是 number：调用方一边是 LLM 返回的任意值，
 * 一边是 <video>.duration（在元数据加载前是 NaN）。非法输入一律按 0 处理，
 * 保证界面上永远不会出现 "NaN:aN"。
 */
export function formatTime(seconds: unknown) {
  const value = typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

/**
 * 把 Markdown 退化成纯文本，用于复制到剪贴板。
 *
 * 用户复制这段文案是要粘进 TikTok 私信或邮件的，那些地方不渲染 Markdown，
 * 星号和井号会原样显示出来。
 *
 * 这是一组「够用就好」的正则，不是完整的 Markdown 解析器——嵌套语法、
 * 代码块内的字面量星号等边界情况处理不了。为此引入一个解析器不划算，
 * 已知局限记录在此。
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "") // 标题
    .replace(/\*\*(.+?)\*\*/g, "$1") // 粗体
    .replace(/\*(.+?)\*/g, "$1") // 斜体
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1") // 删除线
    .replace(/`(.+?)`/g, "$1") // 行内代码
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // 链接：保留文字丢掉地址
    .replace(/^[-*+]\s+/gm, "") // 无序列表
    .replace(/^\d+\.\s+/gm, "") // 有序列表
    .replace(/^>\s+/gm, "") // 引用
    .replace(/\n{3,}/g, "\n\n") // 折叠多余空行
    .trim();
}
