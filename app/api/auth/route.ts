import { signJWT } from '@/lib/auth';

// 限流状态存在进程内存里，只对单个实例有效：多实例部署或进程重启后会重置，
// 不是一个严格意义上的分布式限流，只用于挡最基础的暴力破解
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

// x-forwarded-for 可能是逗号分隔的多级代理链（client, proxy1, proxy2...），取第一个即最初的客户端 IP；
// 这两个头都是可以被客户端伪造的，能起到的限流效果依赖部署环境本身的反向代理配置是否可信
function getClientIp(req: Request) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return error(429, 'too_many_attempts');
  }

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, 'missing_password');
  }

  if (typeof body.password !== 'string' || body.password.length === 0) {
    return error(400, 'missing_password');
  }

  // 除了正式密码 AUTH_TOKEN，还接受 DEMO_AUTH_TOKEN 作为演示环境专用的第二个密码
  const validTokens = [process.env.AUTH_TOKEN, process.env.DEMO_AUTH_TOKEN].filter(Boolean);
  if (!validTokens.includes(body.password)) {
    return error(401, 'invalid_password');
  }

  try {
    return json({ token: await signJWT() });
  } catch (err) {
    return error(500, 'auth_failed', err instanceof Error ? err.message : undefined);
  }
}
