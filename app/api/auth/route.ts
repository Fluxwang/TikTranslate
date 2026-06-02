import { signJWT } from '@/lib/auth';

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

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

  if (body.password !== process.env.AUTH_TOKEN) {
    return error(401, 'invalid_password');
  }

  try {
    return json({ token: await signJWT() });
  } catch (err) {
    return error(500, 'auth_failed', err instanceof Error ? err.message : undefined);
  }
}
