"use client";

import { useCallback, useMemo, useState } from "react";

import type { AuthedFetch } from "./useAuthedFetch";

type TikHubResponse = {
  videoUrls: string[];
  author: string;
  durationSec: number;
  coverUrl: string;
};

/**
 * 把 TikTok 分享链接解析成可播放的视频地址。
 *
 * TikHub 会返回**多个**候选 CDN 地址。这些地址是短时效的，且不同 CDN 节点
 * 可用性不一，所以拿到的是一个列表而不是单个 URL：播放失败时由
 * fallbackToNextUrl() 切到下一个候选，全部试完才算失败。
 * 也因为短时效，这些地址绝不能缓存。
 */
export function useVideoSource(authedFetch: AuthedFetch) {
  const [url, setUrl] = useState("");
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoIndex, setVideoIndex] = useState(0);
  const [coverUrl, setCoverUrl] = useState("");
  const [durationSec, setDurationSec] = useState(0);

  const videoUrl = videoUrls[videoIndex] ?? "";

  const reset = useCallback(() => {
    setVideoUrls([]);
    setVideoIndex(0);
    setCoverUrl("");
    setDurationSec(0);
  }, []);

  /** 解析链接。返回是否成功，由调用方决定后续的阶段流转。 */
  const parse = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return false;

    reset();

    const res = await authedFetch("/api/tikhub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as TikHubResponse;
    setVideoUrls(data.videoUrls);
    setCoverUrl(data.coverUrl);
    // TikHub 偶尔返回 0 或缺失，这时留空等 loadedmetadata 用真实时长补上
    setDurationSec(data.durationSec || 0);
    return true;
  }, [authedFetch, reset, url]);

  /** 当前地址播不动时切到下一个候选；已经是最后一个则原地不动。 */
  const fallbackToNextUrl = useCallback(() => {
    setVideoIndex((idx) => (idx + 1 < videoUrls.length ? idx + 1 : idx));
  }, [videoUrls.length]);

  return useMemo(
    () => ({
      url,
      setUrl,
      videoUrl,
      videoUrls,
      videoIndex,
      coverUrl,
      durationSec,
      setDurationSec,
      parse,
      reset,
      fallbackToNextUrl,
    }),
    [coverUrl, durationSec, fallbackToNextUrl, parse, reset, url, videoIndex, videoUrl, videoUrls],
  );
}
