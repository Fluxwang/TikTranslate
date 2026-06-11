import { createReadStream } from 'node:fs';
import { getTmpVideoFile } from '@/lib/tmpVideo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ id: string }>;
};

function notFound() {
  return new Response(null, { status: 404 });
}

function baseHeaders(mimeType: string, size: number) {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': String(size),
    'Content-Type': mimeType,
  });
}

function parseRange(value: string | null, size: number) {
  if (!value) return null;

  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return 'invalid' as const;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return 'invalid' as const;

  let start: number;
  let end: number;

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid' as const;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return 'invalid' as const;
  }

  return { start, end: Math.min(end, size - 1) };
}

function fileReadableStream(filePath: string, range?: { start: number; end: number }) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stream = createReadStream(filePath, range);

      stream.on('data', (chunk) => {
        controller.enqueue(typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
          : new Uint8Array(chunk as Buffer));
      });
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
  });
}

async function getFile(req: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get('token');
  return getTmpVideoFile(id, token);
}

export async function HEAD(req: Request, { params }: RouteParams) {
  const file = await getFile(req, params);
  if (!file) return notFound();

  return new Response(null, {
    status: 200,
    headers: baseHeaders(file.meta.mimeType, file.size),
  });
}

export async function GET(req: Request, { params }: RouteParams) {
  const file = await getFile(req, params);
  if (!file) return notFound();

  const range = parseRange(req.headers.get('range'), file.size);
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Range': `bytes */${file.size}`,
      },
    });
  }

  if (range) {
    const headers = baseHeaders(file.meta.mimeType, range.end - range.start + 1);
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);

    const stream = fileReadableStream(file.filePath, {
      start: range.start,
      end: range.end,
    });

    return new Response(stream, {
      status: 206,
      headers,
    });
  }

  return new Response(fileReadableStream(file.filePath), {
    status: 200,
    headers: baseHeaders(file.meta.mimeType, file.size),
  });
}
