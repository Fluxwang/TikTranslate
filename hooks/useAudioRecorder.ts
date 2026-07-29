"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

// captureStream 至今不在标准 HTMLVideoElement 的类型定义里（各浏览器实现早于规范定稿），
// 因此这里显式声明一个可选方法，调用处配合特性检测使用。
type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
};

type UseAudioRecorderOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 每产出一段音频时调用。startOffset 是这段音频对应的视频时间点（秒）。 */
  onChunk: (blob: Blob, startOffset: number) => void;
};

/**
 * 把 <video> 的音轨录成一段段音频。
 *
 * 这个 hook 刻意不含任何业务概念——它不知道字幕、不知道识别阶段、不发请求，
 * 只负责 MediaRecorder 的生命周期，产出的分片通过 onChunk 交给上层。
 * 业务逻辑在 useTranscription 里。
 *
 * 分片边界不是定时切的：recorder.start() 没有传 timeslice，所以
 * ondataavailable 只在 stop() 时触发一次。真正驱动分片的是「暂停 / 播放结束」，
 * 由调用方在这些时机调 stop()。
 */
export function useAudioRecorder({ videoRef, onChunk }: UseAudioRecorderOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** 当前这段音频的起始视频时间点，在 ondataavailable 里「先取旧值再更新」。 */
  const chunkStartRef = useRef(0);
  const [finalizing, setFinalizing] = useState(false);

  // onChunk 每次渲染都是新函数，而 recorder.ondataavailable 只在 start() 那一刻
  // 绑定一次。如果直接闭包捕获 onChunk，整场录制都会调用绑定那一刻的旧版本，
  // 它捕获的 duration、authedFetch 等值也会一起停留在过去（典型的 stale closure）。
  // 用一个始终指向最新值的 ref 绕开：绑定的是 ref 本身，读取的永远是当前值。
  const onChunkRef = useRef(onChunk);
  useEffect(() => {
    onChunkRef.current = onChunk;
  });

  /** 取（或复用）只含音轨的 MediaStream。返回 null 表示当前视频拿不到音频。 */
  const getAudioStream = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    // track 可能已经 ended（换了视频源等），这时要重新捕获而不是复用
    if (streamRef.current?.getAudioTracks().some((track) => track.readyState === "live")) {
      return streamRef.current;
    }

    const captureStream = (video as CapturableVideo).captureStream;
    const stream = captureStream?.call(video);
    if (!stream || stream.getAudioTracks().length === 0) return null;

    // 只取音轨重新包一个新的 MediaStream——转写只需要音频，
    // 带上视频轨会让 MediaRecorder 白白编码画面，体积和耗时都翻倍
    streamRef.current = new MediaStream(stream.getAudioTracks());
    return streamRef.current;
  }, [videoRef]);

  /** 开始录制。返回是否真的启动了（拿不到音轨、或已在录制中都会返回 false）。 */
  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video || recorderRef.current) return false;

    const audioOnly = getAudioStream();
    if (!audioOnly) return false;

    // 优先指定 opus：不指定时各浏览器默认编码不一致，
    // 上游 Whisper 兼容接口对容器/编码的支持面比浏览器窄
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mimeType
      ? new MediaRecorder(audioOnly, { mimeType })
      : new MediaRecorder(audioOnly);

    chunkStartRef.current = video.currentTime;

    recorder.ondataavailable = (event) => {
      // 先把上一次记录的时间点取出来作为这一段的起点，再立刻更新成当前时间点
      // 留给下一段用——这个「先取旧值再更新」的顺序很容易写反
      const startOffset = chunkStartRef.current;
      chunkStartRef.current = video.currentTime;
      onChunkRef.current(event.data, startOffset);
    };

    recorder.onstop = () => {
      // 只有当前挂着的 recorder 才清空 ref：stop() 是异步回调，
      // 期间可能已经有新的 recorder 顶上，直接清空会把新的一起抹掉
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
      }
      setFinalizing(false);
    };

    recorder.start();
    recorderRef.current = recorder;
    return true;
  }, [getAudioStream, videoRef]);

  /**
   * 停止录制。
   *
   * @param isFinal 传 true 表示这是「收尾」的那次停止。收尾期间 finalizing 为
   *   true，上层据此知道「还有最后一段音频在路上」，不能过早判定识别已完成。
   */
  const stop = useCallback((isFinal = false) => {
    const recorder = recorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      if (isFinal) setFinalizing(true);
      // 暂停状态下直接 stop 不会触发最后一次 ondataavailable，
      // 暂停期间录到的音频会整段丢失，所以必须先 resume
      if (recorder.state === "paused") {
        recorder.resume();
      }
      recorder.stop();
    } else if (isFinal) {
      setFinalizing(false);
    }

    recorderRef.current = null;
    streamRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
    }
  }, []);

  // 卸载时收尾：不这么做的话，用户离开页面时 MediaRecorder 仍在录制，
  // 且 captureStream 拿到的音轨不会被释放。
  // 只在卸载时 stop track——正常 stop() 不停 track，是为了让下一段录制能复用
  // 同一个 captureStream（同一个 video 元素重复调 captureStream 的行为各浏览器不一致）。
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ start, stop, pause, resume, finalizing }),
    [finalizing, pause, resume, start, stop],
  );
}
