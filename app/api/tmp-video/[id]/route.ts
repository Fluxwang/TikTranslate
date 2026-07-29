import { createReadStream } from "node:fs";
import { getTmpVideoFile } from "@/lib/tmpVideo";

// 用到 node:fs 的 createReadStream，Edge 运行时不支持，必须声明 nodejs；
// 这是按 Range 分块读取的视频流接口，必须禁用静态缓存/预渲染
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function notFound() {
  return new Response(null, { status: 404 });
}

function baseHeaders(mimeType: string, size: number) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": String(size),
    "Content-Type": mimeType,
  });
}

// 解析 HTTP Range 请求头（RFC 7233），用于支持视频拖动进度条时的按需加载。
// 返回值三态：null = 没带 Range 头（返回整个文件）；'invalid' = 带了但格式非法或越界（应返回 416）；
// 对象 = 合法范围。Range 头有三种写法："start-end"、"start-"（到文件末尾）、"-N"（最后 N 字节）
function parseRange(value: string | null, size: number) {
  if (!value) return null;

  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid" as const;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return "invalid" as const;

  let start: number;
  let end: number;

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid" as const;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid" as const;
  }

  return { start, end: Math.min(end, size - 1) };
}

// 手动把 Node 的 Readable 流桥接成 Web 标准的 ReadableStream，
// 因为 Response 构造函数要的是 Web 流，而 createReadStream 给的是 Node 流
function fileReadableStream(filePath: string, range?: { start: number; end: number }) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stream = createReadStream(filePath, range);

      stream.on("data", (chunk) => {
        controller.enqueue(
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk as Buffer),
        );
      });
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });
}

// 这个路由不走全站统一的 JWT 鉴权，而是用 URL 里的 token 查询参数
// （对应 lib/tmpVideo.ts 生成的一次性凭证）单独校验——因为 <video> 标签发起的请求带不了自定义请求头
async function getFile(req: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
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

  const range = parseRange(req.headers.get("range"), file.size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Cache-Control": "no-store",
        "Content-Range": `bytes */${file.size}`,
      },
    });
  }

  if (range) {
    const headers = baseHeaders(file.meta.mimeType, range.end - range.start + 1);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);

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
