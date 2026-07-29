// SSRF（服务端请求伪造）防护。
//
// 背景：/api/analyze 会拿前端传来的视频 URL 去服务端 fetch。这个 URL 最初来自
// TikHub 的响应，但请求体是客户端构造的，等于用户可控。如果不过滤就直接 fetch，
// 攻击者可以让我们的服务器去请求内网地址——最典型的目标是云厂商的实例元数据接口
// （169.254.169.254），那里能拿到临时凭证。
//
// 这些函数是纯函数（只做字符串/IP 判断，不发请求），因此可以直接单测，
// 见 lib/url-guard.test.ts。安全逻辑必须有测试兜底，不能靠人工 review。
//
// 注意：这是一层「尽力而为」的防护，无法防住 DNS rebinding
// （域名首次解析到公网 IP 通过校验，实际连接时再解析到内网）。要彻底解决需要
// 在建立连接的那一刻校验对端 IP，Node 的 fetch 目前没有暴露这个钩子。
// 已知局限，记录在此而不是假装没有。

import net from "node:net";

/** localhost / *.localhost。方括号是为了兼容 IPv6 字面量写法 [::1]。 */
export function isLocalhost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * 判断 hostname 是否是需要屏蔽的 IP 字面量。
 *
 * 只处理「hostname 本身就是 IP」的情况——普通域名返回 false 放行，
 * 因为在这一层无法知道它会解析到哪里（见文件头的 DNS rebinding 说明）。
 */
export function isBlockedIp(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(host);
  if (ipVersion === 0) return false;

  if (ipVersion === 4) {
    const parts = host.split(".").map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    // 依次屏蔽：0.x（本网段）、10.x/172.16-31.x/192.168.x（私有网段 RFC1918）、
    // 127.x（回环）、100.64-127.x（运营商级 NAT）、169.254.x（链路本地，
    // 云厂商元数据接口 169.254.169.254 就在这个段里）
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
  // :: 未指定地址、::1 回环、fc00::/7 唯一本地地址（fc/fd 开头）、fe80::/10 链路本地
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

/**
 * 解析并校验一个「可以安全去 fetch」的 http(s) URL。
 *
 * 不合法一律返回 null 而不是抛错：调用方全都是「不合法就走降级」的场景，
 * 用返回值表达比 try/catch 更贴合控制流。
 */
export function parseHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  // 只允许 http/https：file:、data:、gopher: 等协议同样能被 fetch 或其底层库利用
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isLocalhost(url.hostname) || isBlockedIp(url.hostname)) return null;
  return url;
}
