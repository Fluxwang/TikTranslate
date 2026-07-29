/**
 * 日志脱敏。
 *
 * 上游（TikHub / Whisper / LLM）返回的错误文本里可能原样带着我们发过去的
 * 临时视频 URL（含 ?token=）或 Authorization 头。这些字符串一旦进了
 * console.error，就会被部署平台的日志系统长期留存。
 *
 * 所有把「上游返回内容」或「捕获到的异常」写进日志的地方都必须先过这个函数。
 */
export function sanitizeLogText(value: unknown) {
  return String(value)
    .replace(/token=[^&\s"']+/gi, "token=[redacted]")
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [redacted]");
}
