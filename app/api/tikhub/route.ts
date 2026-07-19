import { verifyJWT } from '@/lib/auth';

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
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

// 调试用后门：前端 URL 输入框填 "test1"（大小写不敏感）时不走真实 TikHub 接口，
// 直接返回 TEST1_VIDEO_URL 环境变量指向的固定视频，方便本地联调不消耗 TikHub 配额
function resolveDebugVideoAlias(value: unknown) {
  if (typeof value !== 'string' || value.trim().toLowerCase() !== 'test1') return null;

  return {
    alias: 'test1',
    envName: 'TEST1_VIDEO_URL',
    videoUrl: process.env.TEST1_VIDEO_URL?.trim() ?? '',
  };
}

// 手写的深层取值函数：因为要取的路径是数组变量（下面动态拼出多条不同路径），
// 没法写成固定的可选链 a?.b?.c，所以用循环逐层安全访问
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

  const debugVideo = resolveDebugVideoAlias(body.url);
  if (debugVideo) {
    if (!debugVideo.videoUrl) {
      return error(500, 'debug_video_url_missing', `Set ${debugVideo.envName}`);
    }
    if (!isHttpUrl(debugVideo.videoUrl)) {
      return error(500, 'debug_video_url_invalid', `${debugVideo.envName} must be an HTTP or HTTPS URL`);
    }

    return json({
      videoUrls: [debugVideo.videoUrl],
      author: `@${debugVideo.alias}`,
      durationSec: 0,
      coverUrl: '',
    });
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

  // 以下字段路径是 TikHub（代理抖音/TikTok 接口）返回结构里的固定位置，
  // 不是本项目定义的，改动前需要对照 TikHub 文档确认
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
    durationSec: typeof durationMs === 'number' ? durationMs / 1000 : 0, // TikHub 返回的时长单位是毫秒
    coverUrl: Array.isArray(coverUrls) && typeof coverUrls[0] === 'string' ? coverUrls[0] : '',
  });
}
