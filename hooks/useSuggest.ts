"use client";

import { useCallback } from "react";

import type { AuthedFetch } from "./useAuthedFetch";
import type { Product, SuggestAnalysis, SuggestResponse } from "@/lib/types";

/**
 * 「达人建议」生成：把产品资料 + 视频分析结果交给后端，返回中/英/西三语文案。
 *
 * 这里失败时抛错而不是返回 null，是与其他 hook 不同的选择：调用方
 * （AnalysisPanel 的 CreatorTab）有自己的一套局部 loading / 错误态，
 * 用 try/catch 接住比逐层判空更贴合它的写法。
 */
export function useSuggest(authedFetch: AuthedFetch) {
  return useCallback(
    async (product: Product, analysis: SuggestAnalysis): Promise<SuggestResponse> => {
      const res = await authedFetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, analysis }),
      });
      if (!res.ok) throw new Error("suggest failed");
      return (await res.json()) as SuggestResponse;
    },
    [authedFetch],
  );
}
