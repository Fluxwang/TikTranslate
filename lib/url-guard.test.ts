import { describe, expect, it } from "vitest";

import { isBlockedIp, isLocalhost, parseHttpUrl } from "./url-guard";

describe("isLocalhost", () => {
  it("拦截 localhost 及其子域", () => {
    expect(isLocalhost("localhost")).toBe(true);
    expect(isLocalhost("LOCALHOST")).toBe(true);
    expect(isLocalhost("api.localhost")).toBe(true);
  });

  it("放行普通域名", () => {
    expect(isLocalhost("example.com")).toBe(false);
    // 关键的负例：localhost 出现在中间而不是后缀，不应该被误判
    expect(isLocalhost("localhost.example.com")).toBe(false);
  });
});

describe("isBlockedIp", () => {
  it("拦截 IPv4 内网与保留网段", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "100.64.0.1", // 运营商级 NAT 下界
      "100.127.255.255", // 运营商级 NAT 上界
      "169.254.169.254", // 云厂商实例元数据接口——这条是这层防护最主要的目标
      "172.16.0.1", // RFC1918 下界
      "172.31.255.255", // RFC1918 上界
      "192.168.1.1",
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("放行边界外的公网 IPv4", () => {
    const allowed = [
      "8.8.8.8",
      "100.63.255.255", // 紧邻 100.64 下界之外
      "100.128.0.0", // 紧邻 100.127 上界之外
      "172.15.255.255", // 紧邻 172.16 下界之外
      "172.32.0.0", // 紧邻 172.31 上界之外
      "192.169.0.1", // 与 192.168 只差 1
      "169.253.0.1", // 与 169.254 只差 1
    ];
    for (const ip of allowed) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("拦截 IPv6 回环与本地网段（含方括号写法）", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("[::1]")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("非 IP 的 hostname 一律放行（由 DNS 层负责，见 url-guard.ts 文件头说明）", () => {
    expect(isBlockedIp("example.com")).toBe(false);
    expect(isBlockedIp("not-an-ip")).toBe(false);
  });
});

describe("parseHttpUrl", () => {
  it("放行正常的 http/https URL 并返回 URL 对象", () => {
    expect(parseHttpUrl("https://example.com/v.mp4")?.hostname).toBe("example.com");
    expect(parseHttpUrl("http://example.com/v.mp4")?.protocol).toBe("http:");
  });

  it("拒绝非 http(s) 协议", () => {
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("data:text/plain,hello")).toBeNull();
    expect(parseHttpUrl("ftp://example.com/v.mp4")).toBeNull();
  });

  it("拒绝指向本机或内网的 URL", () => {
    expect(parseHttpUrl("http://localhost:3000/secret")).toBeNull();
    expect(parseHttpUrl("http://127.0.0.1/secret")).toBeNull();
    expect(parseHttpUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(parseHttpUrl("http://[::1]/secret")).toBeNull();
  });

  it("拒绝无法解析的字符串", () => {
    expect(parseHttpUrl("")).toBeNull();
    expect(parseHttpUrl("not a url")).toBeNull();
  });
});
