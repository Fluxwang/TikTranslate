"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * 判定「播放结束」的提前量（秒）。
 *
 * 不死等原生 ended 事件：部分浏览器 / 编码组合下，timeupdate 在接近末尾时会
 * 跳过或延迟，ended 的触发时机不够可靠。提前 0.2 秒判定能保证收尾逻辑一定执行。
 */
const END_EPSILON = 0.2;

type UseVideoPlaybackOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  durationSec: number;
  /** 锁定期间禁止暂停与拖动（识别过程中）。 */
  locked: boolean;
  /** 播放真正结束时调用一次（内部有幂等锁，重复触发只会执行一次）。 */
  onFinalize: () => void;
  /** 用户主动暂停（既不是结束、也不在锁定期间）。 */
  onPause: () => void;
  /** 从暂停恢复播放。 */
  onResume: () => void;
  /** 当前视频地址加载失败。 */
  onSourceError: () => void;
};

/**
 * <video> 的播放状态与用户交互。
 *
 * 与录制的联动全部通过回调向外抛（onFinalize / onPause / onResume），
 * 这一层不认识 MediaRecorder，也不认识识别阶段——它只知道「现在被锁住了」。
 */
export function useVideoPlayback({
  videoRef,
  videoUrl,
  durationSec,
  locked,
  onFinalize,
  onPause,
  onResume,
  onSourceError,
}: UseVideoPlaybackOptions) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);

  // ended 的同步镜像：finalize 会被 timeupdate、原生 ended、暂停事件三条路径
  // 同时触发，必须在同一个事件循环内判重。setState 异步，这里读不到最新值。
  const endedRef = useRef(false);

  // 回调每次渲染都是新函数。存进 ref，下面的事件处理器就不必把它们放进依赖数组，
  // 从而保持自身引用稳定（这些处理器会作为 props 传给 VideoPanel）。
  const callbacksRef = useRef({ onFinalize, onPause, onResume, onSourceError });
  useEffect(() => {
    callbacksRef.current = { onFinalize, onPause, onResume, onSourceError };
  });

  // 换视频源后必须显式 load()：只改 src 属性，已经加载过媒体的 <video>
  // 不会自动重新拉流
  useEffect(() => {
    const video = videoRef.current;
    if (!videoUrl || !video) return;
    video.load();
  }, [videoUrl, videoRef]);

  const markEnded = useCallback((value: boolean) => {
    endedRef.current = value;
    setEnded(value);
  }, []);

  const finalize = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      // 收尾时把进度条推到终点：timeupdate 的最后一帧未必刚好等于 duration
      setCurrentTime(Number.isFinite(video.duration) ? video.duration : video.currentTime);
    }
    setPlaying(false);

    if (endedRef.current) return;
    markEnded(true);
    callbacksRef.current.onFinalize();
  }, [markEnded, videoRef]);

  /** 是否已经播到（判定意义上的）终点。 */
  const isAtEnd = useCallback(
    (video: HTMLVideoElement) => {
      if (video.ended) return true;
      return durationSec > 0 && video.currentTime >= durationSec - END_EPSILON;
    },
    [durationSec],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || locked) return;

    // 已经播完时再点播放，从头开始而不是停在终点
    if (video.ended || (durationSec > 0 && video.currentTime >= durationSec)) {
      video.currentTime = 0;
    }
    if (video.paused) void video.play();
    else video.pause();
  }, [durationSec, locked, videoRef, videoUrl]);

  /**
   * 跳转到指定秒数。
   *
   * 识别过程中禁止跳转：字幕分片的时间戳是靠 currentTime 顺序推进算出来的，
   * 跳一下就会让分片的起止时间与音频内容错位。
   */
  const seek = useCallback(
    (sec: number) => {
      const video = videoRef.current;
      if (!video || locked) return;
      video.currentTime = Math.min(durationSec || video.duration || sec, Math.max(0, sec));
      void video.play();
    },
    [durationSec, locked, videoRef],
  );

  const handleLoadedMetadata = useCallback(
    (fallbackDuration: number) => {
      const video = videoRef.current;
      if (!video) return fallbackDuration;
      // TikHub 给的时长有时是 0 或不准，以媒体自身的元数据为准
      return Number.isFinite(video.duration) ? video.duration : fallbackDuration;
    },
    [videoRef],
  );

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (Number.isFinite(video.duration) && video.duration > 0 && isAtEnd(video)) {
      finalize();
    }
  }, [finalize, isAtEnd, videoRef]);

  const handlePlayStateChange = useCallback(
    (nextPlaying: boolean) => {
      const video = videoRef.current;
      setPlaying(nextPlaying);

      if (nextPlaying) {
        // 从终点重新播放时要解除结束标记，否则下一次收尾会被幂等锁吃掉
        if (endedRef.current) markEnded(false);
        callbacksRef.current.onResume();
        return;
      }

      if (video && isAtEnd(video)) {
        finalize();
        return;
      }

      if (locked && video) {
        // 识别期间不允许暂停——暂停后音频流断了，字幕就和视频进度对不上了。
        // 这也是 VideoPanel 上 locked 属性存在的原因（同时在 UI 上禁用控件）。
        void video.play().catch(() => undefined);
        return;
      }

      callbacksRef.current.onPause();
    },
    [finalize, isAtEnd, locked, markEnded, videoRef],
  );

  const handleSourceError = useCallback(() => {
    callbacksRef.current.onSourceError();
  }, []);

  /** 重新开始一轮播放：回到 0 并清掉结束标记。 */
  const restart = useCallback(() => {
    const video = videoRef.current;
    markEnded(false);
    setCurrentTime(0);
    if (video) video.currentTime = 0;
  }, [markEnded, videoRef]);

  return useMemo(
    () => ({
      currentTime,
      playing,
      setPlaying,
      ended,
      togglePlay,
      seek,
      restart,
      handleLoadedMetadata,
      handleTimeUpdate,
      handlePlayStateChange,
      handleEnded: finalize,
      handleSourceError,
    }),
    [
      currentTime,
      ended,
      finalize,
      handleLoadedMetadata,
      handlePlayStateChange,
      handleSourceError,
      handleTimeUpdate,
      playing,
      restart,
      seek,
      togglePlay,
    ],
  );
}
