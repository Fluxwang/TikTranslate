"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export const TOKEN_STORAGE_KEY = "tt_token";

export type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 带 JWT 的 fetch 包装。
 *
 * 注意它在遇到 401 时**仍然把失败的 Response 返回给调用方**，而不是抛错：
 * 跳转登录页是异步的，当前这次调用的后续代码照样会执行完。
 * 因此每个调用方都必须自己判断 res.ok，不能默认请求一定成功。
 *
 * 之所以不改成抛错：调用方大多是在 try/finally 里维护 loading 计数的，
 * 抛错会让每处都要多写一层 catch，而返回 Response 的写法让「失败」和
 * 「业务错误」走同一条判断路径。
 */
export function useAuthedFetch(): AuthedFetch {
  const router = useRouter();

  return useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        router.replace("/login");
      }
      return res;
    },
    [router],
  );
}

/**
 * 进入页面时若本地没有 token 就跳登录页。
 *
 * 这只是一层「省去一次无谓请求」的前端便利，不是安全边界——
 * 真正的校验在每个 API 路由的 verifyJWT 里。伪造一个 localStorage 值
 * 能骗过这里，但骗不过服务端。
 */
export function useRequireAuth() {
  const router = useRouter();

  useEffect(() => {
    if (!window.localStorage.getItem(TOKEN_STORAGE_KEY)) {
      router.replace("/login");
    }
  }, [router]);
}
