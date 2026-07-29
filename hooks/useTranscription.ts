"use client";

import { useCallback, useMemo, useState } from "react";
import type { RefObject } from "react";

import type { AuthedFetch } from "./useAuthedFetch";
import { useAudioRecorder } from "./useAudioRecorder";
import type { Subtitle } from "@/lib/types";

type UseTranscriptionOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  authedFetch: AuthedFetch;
  /** 视频总时长（秒），随 loadedmetadata 更新，会随每次分片一起发给后端。 */
  durationSec: number;
};

/**
 * 音频分片 → 转写 → 双语字幕。
 *
 * 建在 useAudioRecorder 之上：录制这件事本身由那一层负责，这里只关心
 * 「分片发出去、结果合并进字幕列表、什么时候算全部完成」。
 */
export function useTranscription({ videoRef, authedFetch, durationSec }: UseTranscriptionOptions) {
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  /**
   * 上传一段音频并把返回的字幕合并进列表。
   *
   * 用计数器而不是布尔值标记「转写中」：分片是并发上传的（上一段还没转写完，
   * 下一段就已经产出），布尔值会被后完成的那个提前置回 false，
   * 让上层误以为全部完成。只有计数归零才代表真的没有在途请求了。
   *
   * 请求失败时静默跳过这一段：单段失败不该中断整场识别，用户看到的是
   * 字幕少了一段，而不是整个流程报错停住。
   */
  const sendChunk = useCallback(
    async (blob: Blob, startOffset: number) => {
      if (blob.size === 0) return;

      setPendingCount((n) => n + 1);
      try {
        const form = new FormData();
        form.set("audio", blob, "chunk.webm");
        form.set("startOffset", String(startOffset));
        form.set("durationSec", String(durationSec));

        const res = await authedFetch("/api/transcribe", { method: "POST", body: form });
        if (!res.ok) return;

        const data = (await res.json()) as { segments?: Subtitle[] };
        if (Array.isArray(data.segments) && data.segments.length > 0) {
          const segments = data.segments;
          // 并发返回的顺序不等于时间顺序，所以每次合并后都按时间戳重排。
          // 下游（当前字幕高亮、字幕列表）都依赖这个升序不变式。
          setSubtitles((items) => [...items, ...segments].sort((a, b) => a.t - b.t));
        }
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [authedFetch, durationSec],
  );

  const recorder = useAudioRecorder({ videoRef, onChunk: sendChunk });

  /** 清空已有字幕与计数，用于开始新一轮识别。 */
  const reset = useCallback(() => {
    recorder.stop();
    setSubtitles([]);
    setPendingCount(0);
  }, [recorder]);

  /** 所有分片都已返回、且收尾的那一段也处理完了。 */
  const isSettled = pendingCount === 0 && !recorder.finalizing;

  // 返回值用 useMemo 稳定住，调用方才能安全地把整个对象写进依赖数组。
  // 不这么做的话，每次渲染都是新对象，任何依赖它的 useCallback/useEffect
  // 都会跟着失效——而 exhaustive-deps 又会要求把它写进依赖，形成死结。
  return useMemo(
    () => ({
      subtitles,
      pendingCount,
      isSettled,
      reset,
      start: recorder.start,
      stop: recorder.stop,
      pause: recorder.pause,
      resume: recorder.resume,
    }),
    [
      isSettled,
      pendingCount,
      recorder.pause,
      recorder.resume,
      recorder.start,
      recorder.stop,
      reset,
      subtitles,
    ],
  );
}
