"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import TopBar from "@/components/TopBar";
import VideoPanel from "@/components/VideoPanel";
import SubtitlePanel from "@/components/SubtitlePanel";
import AnalysisPanel from "@/components/AnalysisPanel";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useAuthedFetch, useRequireAuth } from "@/hooks/useAuthedFetch";
import { useChat } from "@/hooks/useChat";
import { useProducts } from "@/hooks/useProducts";
import { useSuggest } from "@/hooks/useSuggest";
import { useTheme } from "@/hooks/useTheme";
import { useTranscription } from "@/hooks/useTranscription";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { useVideoSource } from "@/hooks/useVideoSource";
import type { Phase } from "@/lib/types";

// 整条主流程：
//   解析 TikTok 链接拿到视频地址（useVideoSource）
//   → 播放视频，同时用 MediaRecorder 分段截取音轨（useVideoPlayback + useTranscription）
//   → 每段音频发去转写并翻译，合并成双语字幕
//   → 全部识别完成后把整段字幕交给 AI 分析（useAnalysis）
//   → 用户可基于字幕与分析结果继续追问（useChat）
//
// 这个组件本身只做三件事：持有 phase 状态机、把各领域 hook 接起来、摆布局。
// 具体逻辑都在 hooks/ 下，每个 hook 只认识自己那一段。
export default function Home() {
  useRequireAuth();

  const authedFetch = useAuthedFetch();
  const { theme, toggleTheme } = useTheme();
  const { products, setProducts } = useProducts();

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // phase 覆盖的是「解析 + 识别」这条主线；AI 分析有自己独立的一套阶段
  // （useAnalysis 内部的 AnalysisPhase），两者不要混用
  const [phase, setPhase] = useState<Phase>("idle");
  const locked = phase === "recognizing";

  const source = useVideoSource(authedFetch);
  const transcription = useTranscription({
    videoRef,
    authedFetch,
    durationSec: source.durationSec,
  });
  const analysis = useAnalysis({ authedFetch });
  const chat = useChat({ authedFetch });
  const requestSuggestion = useSuggest(authedFetch);

  // 播放结束时收尾录制。传 locked 是为了区分「识别中播完」和「随便看看播完」——
  // 前者还有最后一段音频要等它转写回来，后者没有
  const handleFinalize = useCallback(() => {
    transcription.stop(locked);
  }, [locked, transcription]);

  const playback = useVideoPlayback({
    videoRef,
    videoUrl: source.videoUrl,
    durationSec: source.durationSec,
    locked,
    onFinalize: handleFinalize,
    onPause: transcription.pause,
    onResume: transcription.resume,
    onSourceError: source.fallbackToNextUrl,
  });

  /** 清空上一轮的一切结果，供「重新解析」和「重新识别」共用。 */
  const resetSession = useCallback(() => {
    transcription.reset();
    analysis.reset();
    chat.reset();
    playback.restart();
  }, [analysis, chat, playback, transcription]);

  const handleParse = useCallback(async () => {
    if (!source.url.trim()) return;

    setPhase("parsing");
    resetSession();
    playback.setPlaying(false);

    setPhase((await source.parse()) ? "loaded" : "idle");
  }, [playback, resetSession, source]);

  const handleStartRecognition = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !source.videoUrl || phase !== "loaded") return;

    resetSession();
    setPhase("recognizing");

    try {
      // 必须先 play() 再开录：captureStream 要拿到已经在播放的音轨，
      // 而且 play() 可能因为浏览器的自动播放策略被拒绝
      await video.play();
      transcription.start();
    } catch {
      playback.setPlaying(false);
      setPhase("loaded");
    }
  }, [phase, playback, resetSession, source.videoUrl, transcription]);

  // 进入「已识别」需要三个条件同时成立：视频播完了、所有分片都转写返回了、
  // 收尾的那一段也处理完了。少任何一个都可能让 AI 分析拿到不完整的字幕。
  //
  // setTimeout(0) 是刻意推迟到下一个 tick：直接 setPhase 会和触发这次 effect 的
  // 那次状态更新挤在同一个渲染周期里。
  useEffect(() => {
    if (phase !== "recognizing" || !playback.ended || !transcription.isSettled) return;
    const timer = window.setTimeout(() => setPhase("recognized"), 0);
    return () => window.clearTimeout(timer);
  }, [phase, playback.ended, transcription.isSettled]);

  const handleLoadedMetadata = useCallback(() => {
    source.setDurationSec(playback.handleLoadedMetadata(source.durationSec));
  }, [playback, source]);

  const handleStartAnalysis = useCallback(() => {
    if (phase !== "recognized") return;
    void analysis.start({
      subtitles: transcription.subtitles,
      videoUrls: source.videoUrls,
      videoIndex: source.videoIndex,
      durationSec: source.durationSec,
    });
  }, [analysis, phase, source, transcription.subtitles]);

  const handleSend = useCallback(
    (question: string) =>
      chat.send(question, {
        subtitles: transcription.subtitles,
        analysis: analysis.data,
      }),
    [analysis.data, chat, transcription.subtitles],
  );

  // 找到「时间点 <= 当前播放时间」的最后一条字幕。依赖 subtitles 已按 t 升序
  // （排序在 useTranscription 合并新分片时完成），所以遇到未来的字幕就能提前退出
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < transcription.subtitles.length; i++) {
      if (transcription.subtitles[i].t <= playback.currentTime) idx = i;
      else break;
    }
    return idx;
  }, [playback.currentTime, transcription.subtitles]);

  const activeSub = activeIdx >= 0 ? transcription.subtitles[activeIdx] : null;

  return (
    <div className="app">
      <TopBar
        phase={phase}
        url={source.url}
        setUrl={source.setUrl}
        onParse={handleParse}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="main">
        <VideoPanel
          phase={phase}
          sub={activeSub}
          videoRef={videoRef}
          videoUrl={source.videoUrl}
          coverUrl={source.coverUrl}
          currentTime={playback.currentTime}
          duration={source.durationSec}
          playing={playback.playing}
          onTogglePlay={playback.togglePlay}
          onSeek={playback.seek}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={playback.handleTimeUpdate}
          onEnded={playback.handleEnded}
          onPlayStateChange={playback.handlePlayStateChange}
          onVideoError={playback.handleSourceError}
          locked={locked}
        />
        <SubtitlePanel
          phase={phase}
          subtitles={transcription.subtitles}
          recognizedCount={transcription.subtitles.length}
          activeIdx={activeIdx}
          recogClock={playback.currentTime}
          onSeek={playback.seek}
          onStartRecognition={handleStartRecognition}
        />
        <AnalysisPanel
          phase={phase}
          analysisPhase={analysis.phase}
          analysisStep={analysis.step}
          analysisError={analysis.errorMessage}
          data={analysis.data}
          durationSec={source.durationSec}
          products={products}
          setProducts={setProducts}
          thread={chat.thread}
          onSend={handleSend}
          onSuggest={requestSuggestion}
          askPending={chat.pending}
          onStartAnalysis={handleStartAnalysis}
        />
      </div>
    </div>
  );
}
