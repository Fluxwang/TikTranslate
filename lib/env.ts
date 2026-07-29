/**
 * 读取必填环境变量，缺失时抛错。
 *
 * 为什么是运行时读取而不是启动时统一校验：route handler 按需实例化，
 * 不同路由需要的 key 不同（只做转录不做分析的部署根本用不到 ANALYSIS_* 系列）。
 * 启动时全量校验会让这类部署无法启动。
 *
 * 错误信息里只带变量名、绝不带值——它会被 catch 后放进响应的 detail 字段返回给客户端。
 */
export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
