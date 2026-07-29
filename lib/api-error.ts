// API 路由共用的响应构造器与错误契约。
//
// 抽出来之前这两个函数在 6 个 route 文件里逐字重复
// （analyze / auth / chat / suggest / tikhub / transcribe），
// 想调整错误响应的字段结构就得改 6 处，漏一处前端就会拿到形状不一致的错误。

/** 成功响应。status 默认 200，需要 201/204 时由调用方显式传入。 */
export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

/**
 * 错误响应，响应体固定为 `{ error: code }` 或 `{ error: code, detail }`。
 *
 * 前端只依赖 `error` 字段做分支判断，`detail` 仅供排查使用，因此它是可选的：
 * 契约中「没有 detail」和「detail 为空字符串」是两种不同的情况，不要合并。
 *
 * 注意 detail 里可能带上游返回的原始文本，调用方有责任先脱敏
 * （见 lib/log.ts 的 sanitizeLogText）。
 */
export function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

/**
 * 把 verifyJWT 抛出的异常统一转成 401 响应。
 *
 * verifyJWT 用 Error.message 承载错误码（"missing_token" 等），这里把它原样
 * 放进 detail——它不含任何敏感信息，且能帮前端区分「没带 token」和「token 过期」。
 */
export function unauthorized(err: unknown) {
  return error(401, "unauthorized", err instanceof Error ? err.message : undefined);
}
