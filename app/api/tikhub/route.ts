import { verifyJWT } from '@/lib/auth';

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

function isTikTokUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      (parsed.hostname === 'tiktok.com' || parsed.hostname.endsWith('.tiktok.com'))
    );
  } catch {
    return false;
  }
}

function getAtPath(data: unknown, path: string[]) {
  let current = data;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, 'invalid_url');
  }

  if (!isTikTokUrl(body.url)) {
    return error(400, 'invalid_url');
  }

  const endpoint = new URL('https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_one_video_by_share_url');
  endpoint.searchParams.set('share_url', body.url);

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.TIKHUB_API_KEY ?? ''}`,
      },
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'tikhub_failed', err instanceof Error ? err.message : undefined);
  }

  if (!upstream.ok) {
    return error(502, 'tikhub_failed', `TikHub status ${upstream.status}`);
  }

  const payload = await upstream.json();
  const videoUrls = getAtPath(payload, ['data', 'aweme_detail', 'video', 'play_addr_h264', 'url_list']);
  const uniqueId = getAtPath(payload, ['data', 'aweme_detail', 'author', 'unique_id']);
  const durationMs = getAtPath(payload, ['data', 'aweme_detail', 'video', 'duration']);
  const coverUrls = getAtPath(payload, ['data', 'aweme_detail', 'video', 'cover', 'url_list']);

  if (!Array.isArray(videoUrls) || videoUrls.length === 0 || !videoUrls.every((u) => typeof u === 'string')) {
    return error(502, 'tikhub_failed', `TikHub status ${upstream.status}; url_list empty`);
  }

  const author = typeof uniqueId === 'string' && uniqueId.length > 0
    ? uniqueId.startsWith('@') ? uniqueId : `@${uniqueId}`
    : '';

  return json({
    videoUrls,
    author,
    durationSec: typeof durationMs === 'number' ? durationMs / 1000 : 0,
    coverUrl: Array.isArray(coverUrls) && typeof coverUrls[0] === 'string' ? coverUrls[0] : '',
  });
}
