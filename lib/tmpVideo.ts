import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const DEFAULT_TMP_DIR = '/tmp/tiktranslate-analysis-videos';
const TMP_VIDEO_TTL_MS = 30 * 60 * 1000;
const TMP_VIDEO_DELETE_DELAY_MS = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 2;

export type VideoFallbackReason =
  | 'no_video_input'
  | 'invalid_video_url'
  | 'test_video_url_invalid'
  | 'public_app_url_missing'
  | 'public_app_url_invalid'
  | 'video_download_failed'
  | 'video_too_large'
  | 'tmp_video_url_unavailable'
  | 'qwen_video_failed'
  | 'qwen_video_json_parse_failed'
  | 'qwen_video_not_observed';

export type VideoInputMode = 'test_url' | 'server_tmp_url' | 'none';

export interface TmpVideoMeta {
  id: string;
  token: string;
  mimeType: string;
  fileName: string;
  createdAt: string;
  expiresAt: string;
  sourceUrlHash: string;
}

export interface PreparedVideoInput {
  url: string;
  mode: Exclude<VideoInputMode, 'none'>;
  tmpVideoId?: string;
}

export class TmpVideoError extends Error {
  reason: VideoFallbackReason;

  constructor(reason: VideoFallbackReason, message: string) {
    super(message);
    this.name = 'TmpVideoError';
    this.reason = reason;
  }
}

function getTmpRoot() {
  return process.env.ANALYSIS_TMP_VIDEO_DIR?.trim() || DEFAULT_TMP_DIR;
}

function isLocalhost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost');
}

function isBlockedIp(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(host);
  if (ipVersion === 0) return false;

  if (ipVersion === 4) {
    const parts = host.split('.').map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  const normalized = host.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function parseHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isLocalhost(url.hostname) || isBlockedIp(url.hostname)) return null;
  return url;
}

export function getValidAnalysisTestVideoUrl() {
  const raw = process.env.ANALYSIS_TEST_VIDEO_URL?.trim();
  if (!raw) return { url: null, reason: null as VideoFallbackReason | null };

  const parsed = parseHttpUrl(raw);
  if (!parsed) return { url: null, reason: 'test_video_url_invalid' as const };
  return { url: parsed.toString(), reason: null };
}

export function getValidPublicAppOrigin() {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  if (!raw) return { origin: null, reason: 'public_app_url_missing' as const };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { origin: null, reason: 'public_app_url_invalid' as const };
  }

  const hasPath = parsed.pathname !== '' && parsed.pathname !== '/';
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    hasPath ||
    parsed.search ||
    parsed.hash ||
    isLocalhost(parsed.hostname) ||
    isBlockedIp(parsed.hostname)
  ) {
    return { origin: null, reason: 'public_app_url_invalid' as const };
  }

  return { origin: parsed.origin, reason: null };
}

function sourceUrlHash(url: string) {
  return createHash('sha256').update(url).digest('hex');
}

async function writeResponseBodyToFile(res: Response, filePath: string) {
  if (!res.body) {
    throw new TmpVideoError('video_download_failed', 'download response body is empty');
  }

  const writer = createWriteStream(/* turbopackIgnore: true */ filePath, { flags: 'wx' });
  const reader = res.body.getReader();
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TmpVideoError('video_too_large', 'downloaded video exceeded size limit');
      }

      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    await new Promise<void>((resolve, reject) => {
      writer.once('error', reject);
      writer.end(resolve);
    });
  } catch (err) {
    writer.destroy();
    throw err;
  }

  return total;
}

async function fetchDownloadableVideo(url: URL, redirectsRemaining = MAX_REDIRECTS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.1',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TmpVideoError('video_download_failed', 'video download timed out');
    }
    throw new TmpVideoError('video_download_failed', err instanceof Error ? err.message : 'video download failed');
  }
  clearTimeout(timer);

  if (res.status >= 300 && res.status < 400) {
    if (redirectsRemaining <= 0) {
      throw new TmpVideoError('video_download_failed', 'too many video download redirects');
    }

    const location = res.headers.get('location');
    if (!location) {
      throw new TmpVideoError('video_download_failed', 'video download redirect missing location');
    }

    const redirected = parseHttpUrl(new URL(location, url).toString());
    if (!redirected) {
      throw new TmpVideoError('invalid_video_url', 'video download redirected to a blocked URL');
    }

    return fetchDownloadableVideo(redirected, redirectsRemaining - 1);
  }

  if (!res.ok) {
    throw new TmpVideoError('video_download_failed', `video download status ${res.status}`);
  }

  const contentLength = Number.parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
    throw new TmpVideoError('video_too_large', 'video content-length exceeded size limit');
  }

  const contentType = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new TmpVideoError('video_download_failed', `unsupported video content type ${contentType || 'unknown'}`);
  }

  return res;
}

function selectVideoCandidates(videoUrls: unknown, videoIndex: unknown) {
  if (!Array.isArray(videoUrls)) return [];

  const index = typeof videoIndex === 'number' && Number.isInteger(videoIndex) ? videoIndex : 0;
  const ordered = [
    videoUrls[index],
    ...videoUrls.filter((_, itemIndex) => itemIndex !== index),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return [...new Set(ordered.map((value) => value.trim()))].slice(0, 3);
}

async function createTmpVideoFromSource(sourceUrl: string, publicOrigin: string): Promise<PreparedVideoInput> {
  const parsed = parseHttpUrl(sourceUrl);
  if (!parsed) {
    throw new TmpVideoError('invalid_video_url', 'video URL is invalid or blocked');
  }

  const id = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const root = getTmpRoot();
  const dir = path.join(/* turbopackIgnore: true */ root, id);
  const fileName = 'video.bin';
  const filePath = path.join(/* turbopackIgnore: true */ dir, fileName);

  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  await mkdir(/* turbopackIgnore: true */ dir);

  try {
    const res = await fetchDownloadableVideo(parsed);
    await writeResponseBodyToFile(res, filePath);

    const now = Date.now();
    const meta: TmpVideoMeta = {
      id,
      token,
      mimeType: res.headers.get('content-type')?.split(';')[0].trim() || 'video/mp4',
      fileName,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TMP_VIDEO_TTL_MS).toISOString(),
      sourceUrlHash: sourceUrlHash(parsed.toString()),
    };

    await writeFile(
      /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf8',
    );

    return {
      url: `${publicOrigin}/api/tmp-video/${id}?token=${token}`,
      mode: 'server_tmp_url',
      tmpVideoId: id,
    };
  } catch (err) {
    await rm(/* turbopackIgnore: true */ dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function prepareServerTmpVideo(videoUrls: unknown, videoIndex: unknown, publicOrigin: string) {
  await cleanupExpiredTmpVideos();

  const candidates = selectVideoCandidates(videoUrls, videoIndex);
  if (candidates.length === 0) {
    throw new TmpVideoError('invalid_video_url', 'request did not include any video URL candidates');
  }

  let sawValidCandidate = false;
  let lastError: TmpVideoError | null = null;

  for (const candidate of candidates) {
    if (!parseHttpUrl(candidate)) {
      lastError = new TmpVideoError('invalid_video_url', 'video URL is invalid or blocked');
      continue;
    }

    sawValidCandidate = true;
    try {
      return await createTmpVideoFromSource(candidate, publicOrigin);
    } catch (err) {
      if (err instanceof TmpVideoError) {
        lastError = err;
        if (err.reason === 'video_too_large') throw err;
        continue;
      }
      lastError = new TmpVideoError('video_download_failed', err instanceof Error ? err.message : 'video download failed');
    }
  }

  if (!sawValidCandidate) {
    throw new TmpVideoError('invalid_video_url', lastError?.message ?? 'all video URL candidates were invalid');
  }

  throw lastError ?? new TmpVideoError('video_download_failed', 'all video download candidates failed');
}

export async function readTmpVideoMeta(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;

  try {
    const metaPath = path.join(/* turbopackIgnore: true */ getTmpRoot(), id, 'meta.json');
    const raw = await readFile(/* turbopackIgnore: true */ metaPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TmpVideoMeta>;

    if (
      parsed.id !== id ||
      typeof parsed.token !== 'string' ||
      typeof parsed.mimeType !== 'string' ||
      typeof parsed.fileName !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }

    return parsed as TmpVideoMeta;
  } catch {
    return null;
  }
}

export async function getTmpVideoFile(id: string, token: string | null) {
  const meta = await readTmpVideoMeta(id);
  if (!meta || token !== meta.token || Date.parse(meta.expiresAt) <= Date.now()) return null;

  const filePath = path.join(/* turbopackIgnore: true */ getTmpRoot(), id, meta.fileName);
  try {
    const fileStat = await stat(/* turbopackIgnore: true */ filePath);
    if (!fileStat.isFile()) return null;
    return { meta, filePath, size: fileStat.size };
  } catch {
    return null;
  }
}

export async function cleanupExpiredTmpVideos() {
  const root = getTmpRoot();
  let entries: string[];
  try {
    entries = await readdir(/* turbopackIgnore: true */ root);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    const dir = path.join(/* turbopackIgnore: true */ root, entry);
    const meta = await readTmpVideoMeta(entry);
    if (!meta || Date.parse(meta.expiresAt) <= Date.now()) {
      await rm(/* turbopackIgnore: true */ dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }));
}

export function scheduleTmpVideoDelete(id: string | undefined) {
  if (!id || !/^[a-f0-9]{32}$/.test(id)) return;

  const timer = setTimeout(() => {
    void rm(
      /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ getTmpRoot(), id),
      { recursive: true, force: true },
    ).catch(() => undefined);
  }, TMP_VIDEO_DELETE_DELAY_MS);

  timer.unref?.();
}
