"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AuthedFetch } from "./useAuthedFetch";
import { adaptAnalysis, EMPTY_ANALYSIS } from "@/lib/analysis";
import type { AnalysisData, AnalysisPhase, AnalyzeResponse, Subtitle } from "@/lib/types";

/** 骨架屏假进度的推进时间点（毫秒）。 */
const FAKE_PROGRESS_STEPS = [
  { at: 500, step: 1 },
  { at: 1200, step: 2 },
];

type UseAnalysisOptions = {
  authedFetch: AuthedFetch;
};

/**
 * 整段字幕 → AI 分析结果。
 *
 * 注意 step 是**假进度**：/api/analyze 是一次性返回的普通请求，拿不到真实进度。
 * 这两级台阶只是让骨架屏在等待期间有变化，避免用户以为卡死。请求提前返回时
 * 定时器会被清掉，UI 上会看到一次跳跃——这是刻意接受的代价，
 * 真要做真实进度得把接口改成流式，成本不成比例。
 */
export function useAnalysis({ authedFetch }: UseAnalysisOptions) {
  const [phase, setPhase] = useState<AnalysisPhase>("none");
  const [step, setStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState<AnalysisData>(EMPTY_ANALYSIS);

  const timersRef = useRef<number[]>([]);
  // phase 的同步镜像。start() 需要在「同一个事件循环内」判断当前阶段来做幂等，
  // 而 setState 是异步的：连点两次会读到同一个旧 phase，两次都通过检查。
  // ref 在赋值瞬间生效，第二次调用能立刻看到已经在 analyzing。
  const phaseRef = useRef<AnalysisPhase>("none");

  const updatePhase = useCallback((next: AnalysisPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
  }, []);

  // 组件卸载时清掉假进度定时器，否则它们会在已卸载的组件上调用 setState
  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    updatePhase("none");
    setStep(0);
    setErrorMessage("");
    setData(EMPTY_ANALYSIS);
  }, [clearTimers, updatePhase]);

  /**
   * 发起分析。只有 phase 为 "none" 时才真正执行——分析成本高（一次多模态
   * LLM 调用），失败后也不自动重试，需要用户显式重新开始一轮。
   */
  const start = useCallback(
    async (input: {
      subtitles: Subtitle[];
      videoUrls: string[];
      videoIndex: number;
      durationSec: number;
    }) => {
      if (input.subtitles.length === 0 || phaseRef.current !== "none") return;

      updatePhase("analyzing");
      setStep(0);
      clearTimers();
      timersRef.current = FAKE_PROGRESS_STEPS.map(({ at, step: value }) =>
        window.setTimeout(() => setStep(value), at),
      );

      try {
        const res = await authedFetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            detail?: string;
          } | null;
          setErrorMessage(body?.detail || body?.error || "分析接口请求失败");
          updatePhase("failed");
          return;
        }

        setData(adaptAnalysis((await res.json()) as AnalyzeResponse, input.durationSec));
        setStep(3);
        setErrorMessage("");
        updatePhase("done");
      } catch (err) {
        // 网络中断、超时、响应体不是合法 JSON 都会走到这里。不接住的话
        // phase 会永远停在 analyzing：骨架屏一直转，而幂等锁又挡住了重试，
        // 用户只能刷新页面。落到 failed 才能让「重新分析」按钮重新可用。
        setErrorMessage(err instanceof Error ? err.message : "分析请求失败，请重试");
        updatePhase("failed");
      } finally {
        clearTimers();
      }
    },
    [authedFetch, clearTimers, updatePhase],
  );

  return useMemo(
    () => ({ phase, step, errorMessage, data, start, reset }),
    [data, errorMessage, phase, reset, start, step],
  );
}
