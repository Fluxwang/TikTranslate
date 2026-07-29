"use client";

import { useCallback, useMemo, useState } from "react";

import type { AuthedFetch } from "./useAuthedFetch";
import type { AnalysisData, Subtitle } from "@/lib/types";

/** 一问一答。answer 为 null 表示还在等回复。 */
export type ChatTurn = { q: string; a: string | null };

/** 发给后端的历史条数上限（按「条消息」算，一问一答是 2 条）。 */
const MAX_HISTORY_MESSAGES = 20;

type UseChatOptions = {
  authedFetch: AuthedFetch;
};

/** 把本地的「一问一答」结构摊平成后端要的 role/content 序列。 */
function toHistory(thread: ChatTurn[]) {
  return thread
    .flatMap((turn) => {
      // 还没拿到回答的那一轮只发问题，不能塞一条空的 assistant 消息进去
      if (!turn.a) return [{ role: "user" as const, content: turn.q }];
      return [
        { role: "user" as const, content: turn.q },
        { role: "assistant" as const, content: turn.a },
      ];
    })
    .slice(-MAX_HISTORY_MESSAGES);
}

/**
 * 基于字幕与分析结果的多轮追问。
 *
 * 每次提问都把「完整字幕 + 完整分析结果」作为上下文重新发给后端——
 * 服务端不存会话，历史完全由客户端持有。刷新页面对话就没了，
 * 这是当前阶段刻意的取舍：省掉一整套会话存储，代价是上下文每次重传。
 */
export function useChat({ authedFetch }: UseChatOptions) {
  const [thread, setThread] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);

  const reset = useCallback(() => {
    setThread([]);
    setPending(false);
  }, []);

  const send = useCallback(
    async (question: string, context: { subtitles: Subtitle[]; analysis: AnalysisData }) => {
      // 记下这一轮在数组里的下标，占位插入一条「回答中」；等接口返回后按下标
      // 更新对应那条，而不是默认它一定是最后一条——用户在等待期间完全可能
      // 又发了新问题，那时最后一条已经不是这一轮了
      const index = thread.length;
      setThread((items) => [...items, { q: question, a: null }]);
      setPending(true);

      try {
        const res = await authedFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            history: toHistory(thread),
            subtitles: context.subtitles,
            analysis: context.analysis,
          }),
        });

        const data = res.ok ? ((await res.json()) as { answer?: string }) : { answer: "" };
        setThread((items) =>
          items.map((turn, i) => (i === index ? { ...turn, a: data.answer || "" } : turn)),
        );
      } catch {
        // 请求抛错（网络中断等）时这一轮的 a 会永远停在 null，UI 上就是
        // 一条永远「回答中」的消息。写成空字符串至少让它落地成「没有回答」，
        // 用户能看出这轮失败了并重新提问。
        setThread((items) => items.map((turn, i) => (i === index ? { ...turn, a: "" } : turn)));
      } finally {
        setPending(false);
      }
    },
    [authedFetch, thread],
  );

  return useMemo(() => ({ thread, pending, send, reset }), [pending, reset, send, thread]);
}
