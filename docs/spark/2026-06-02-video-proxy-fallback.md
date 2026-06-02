# Video Proxy 备选方案

**触发条件：** TikTok CDN 不返回 `Access-Control-Allow-Origin` 响应头，导致 `crossOrigin="anonymous"` 的 `<video>` 无法播放，或 Web Audio API 捕获音频失败（字幕始终为空）。

**排查方法：** 打开浏览器 DevTools → Network → 找到视频请求 → 查看响应头是否包含 `Access-Control-Allow-Origin`。如果没有，或值不匹配当前域，则需要启用本方案。

---

## 方案 A：后端视频代理

新增一条 Route Handler，将 TikTok CDN 视频流转发并附加跨域头：

### `GET /api/video-proxy`

**Request:**
```
GET /api/video-proxy?url=https%3A%2F%2Fcdn.tiktok.com%2F...
Authorization: Bearer <jwt>
```

**实现逻辑：**
```ts
export async function GET(req: Request) {
  verifyJWT(req);

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return Response.json({ error: 'missing_url' }, { status: 400 });

  const upstream = await fetch(url);
  if (!upstream.ok) return Response.json({ error: 'proxy_failed' }, { status: 502 });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',  // CDN URL 有时效，禁止缓存
    },
  });
}
```

**Route 配置：**
```ts
export const maxDuration = 60;
```

**前端改动：**
- `/api/tikhub` 返回的 `videoUrls` 不变
- `<video>` 的 `src` 改为经过代理的地址：
  ```ts
  const proxiedUrl = `/api/video-proxy?url=${encodeURIComponent(videoUrls[0])}`;
  ```
- `crossOrigin="anonymous"` 保留不变

**注意事项：**
- 视频流经服务器转发，会消耗服务器带宽，高分辨率视频（1080p）码率约 2–5 Mbps
- CDN URL 有时效，前端拿到后应立即使用，不可缓存代理地址
- 仅在确认 TikTok CDN 不支持跨域时启用，优先使用直连方案
