"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import VideoPanel from "@/components/VideoPanel";
import SubtitlePanel from "@/components/SubtitlePanel";
import AnalysisPanel from "@/components/AnalysisPanel";
import { adaptAnalysis, EMPTY_ANALYSIS, loadProducts, saveProducts } from "@/lib/analysis";
import type {
  AnalysisData,
  AnalysisPhase,
  AnalyzeResponse,
  Phase,
  Product,
  Subtitle,
  SuggestAnalysis,
  SuggestResponse,
} from "@/lib/types";

// 整体流程：解析 TikTok 链接拿到视频地址 → 播放视频的同时用 MediaRecorder
// 每隔一段时间（暂停/结束时）截取一段音频，发到 /api/transcribe 转写+翻译成双语字幕 →
// 全部识别完成后再把字幕整体发到 /api/analyze 做 AI 分析。
type TikHubResponse = {
  videoUrls: string[];
  author: string;
  durationSec: number;
  coverUrl: string;
};

export default function Home() {
  const router = useRouter();
  // 这几个用 ref 而不是 state：它们要在事件回调（如 MediaRecorder 的 ondataavailable）里
  // 同步读写最新值，用 state 会有闭包拿到旧值的问题，而且它们的变化不需要触发重新渲染
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const chunkStartRef = useRef(0);
  const endedRef = useRef(false);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoIndex, setVideoIndex] = useState(0);
  const [coverUrl, setCoverUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [transcribePending, setTranscribePending] = useState(0);
  const [recorderFinalizing, setRecorderFinalizing] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("none");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisData, setAnalysisData] = useState<AnalysisData>(EMPTY_ANALYSIS);
  const [thread, setThread] = useState<{ q: string; a: string | null }[]>([]);
  const [askPending, setAskPending] = useState(false);
  const [products, setProducts] = useState<Product[]>(() => loadProducts());

  const videoUrl = videoUrls[videoIndex] ?? "";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    saveProducts(products);
  }, [products]);

  useEffect(() => {
    const token = window.localStorage.getItem("tt_token");
    if (!token) router.replace("/login");
  }, [router]);

  const authedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const token = window.localStorage.getItem("tt_token");
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        // 401 时会跳转登录页，但函数仍然把这个失败的 res 返回给调用方——
        // 调用方必须自己判断 res.ok，不能默认请求一定成功
        window.localStorage.removeItem("tt_token");
        router.replace("/login");
      }
      return res;
    },
    [router],
  );

  const stopRecorder = useCallback((finalizing = false) => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (finalizing) setRecorderFinalizing(true);
      // 暂停状态下不能直接 stop，先 resume 再 stop 才能保证触发最后一次 ondataavailable，
      // 否则暂停期间录到的最后一小段音频会丢失
      if (recorder.state === "paused") {
        recorder.resume();
      }
      recorder.stop();
    } else if (finalizing) {
      setRecorderFinalizing(false);
    }
    mediaRecorderRef.current = null;
    audioStreamRef.current = null;
  }, []);

  // 用计数器而不是布尔值，是因为可能同时有多个分片请求在途（上一段还没转写完，下一段又开始了）；
  // 只有计数归零才代表"所有分片都处理完了"，见下面判断 recognizing → recognized 的 effect
  const sendAudioChunk = useCallback(
    async (blob: Blob, startOffset: number) => {
      if (blob.size === 0) return;

      setTranscribePending((n) => n + 1);
      try {
        const form = new FormData();
        form.set("audio", blob, "chunk.webm");
        form.set("startOffset", String(startOffset));
        form.set("durationSec", String(duration));
        const res = await authedFetch("/api/transcribe", {
          method: "POST",
          body: form,
        });

        if (!res.ok) return;

        const data = (await res.json()) as { segments?: Subtitle[] };
        if (Array.isArray(data.segments) && data.segments.length > 0) {
          setSubtitles((items) => [...items, ...data.segments!].sort((a, b) => a.t - b.t));
        }
      } finally {
        setTranscribePending((n) => Math.max(0, n - 1));
      }
    },
    [authedFetch, duration],
  );

  const startRecorder = useCallback(() => {
    const video = videoRef.current;
    if (!video || mediaRecorderRef.current) return;

    const getAudioStream = () => {
      if (audioStreamRef.current?.getAudioTracks().some((track) => track.readyState === "live")) {
        return audioStreamRef.current;
      }

      // captureStream 不在标准 HTMLVideoElement 类型定义里，这里做一次特性检测式的类型断言
      const captureStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
        .captureStream;
      const stream = captureStream?.call(video);
      if (!stream || stream.getAudioTracks().length === 0) return null;

      // 只取音轨重新包一个新的 MediaStream——转写只需要音频，不需要带着视频轨一起传递
      audioStreamRef.current = new MediaStream(stream.getAudioTracks());
      return audioStreamRef.current;
    };

    const startChunkRecorder = () => {
      const audioOnly = getAudioStream();
      if (!audioOnly || mediaRecorderRef.current) return;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(audioOnly, { mimeType })
        : new MediaRecorder(audioOnly);
      chunkStartRef.current = video.currentTime;

      // recorder.start() 没传 timeslice，所以 ondataavailable 只在 stop() 时触发一次，
      // 分片边界实际上是由"暂停/播放结束"驱动的（见 stopRecorder / onPlayStateChange），
      // 每次触发时：先把 chunkStartRef 中记录的"上一次的时间点"取出作为这一段的起点，
      // 再立刻把它更新为当前时间点，留给下一段用——这个"先取旧值再更新"的顺序很容易搞反
      recorder.ondataavailable = (event) => {
        const startOffset = chunkStartRef.current;
        chunkStartRef.current = video.currentTime;
        void sendAudioChunk(event.data, startOffset);
      };
      recorder.onstop = () => {
        if (mediaRecorderRef.current === recorder) {
          mediaRecorderRef.current = null;
        }
        setRecorderFinalizing(false);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setPhase("recognizing");
    };

    startChunkRecorder();
  }, [sendAudioChunk]);

  const onParse = async () => {
    if (!url.trim()) return;

    stopRecorder();
    endedRef.current = false;
    setPhase("parsing");
    setCurrentTime(0);
    setPlaying(false);
    setSubtitles([]);
    setTranscribePending(0);
    setRecorderFinalizing(false);
    setAnalysisPhase("none");
    setAnalysisError("");
    setAnalysisStep(0);
    setAnalysisData(EMPTY_ANALYSIS);
    setThread([]);
    setVideoUrls([]);
    setVideoIndex(0);
    setCoverUrl("");
    setDuration(0);

    const res = await authedFetch("/api/tikhub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!res.ok) {
      setPhase("idle");
      return;
    }

    const data = (await res.json()) as TikHubResponse;
    setVideoUrls(data.videoUrls);
    setCoverUrl(data.coverUrl);
    setDuration(data.durationSec || 0);
    setPhase("loaded");
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!videoUrl || !video) return;
    video.load();
  }, [videoUrl]);

  const onTogglePlay = () => {
    const video = videoRef.current;
    if (!video || !videoUrl || phase === "recognizing") return;
    if (video.ended || (duration > 0 && video.currentTime >= duration)) {
      video.currentTime = 0;
    }
    if (video.paused) void video.play();
    else video.pause();
  };

  const onSeek = (sec: number) => {
    const video = videoRef.current;
    // 识别中禁止拖动进度条：字幕分片的时间戳是靠 currentTime 顺序推进的，
    // 拖动会打乱分片起止时间的对齐关系
    if (!video || phase === "recognizing") return;
    video.currentTime = Math.min(duration || video.duration || sec, Math.max(0, sec));
    void video.play();
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : duration);
  };

  const finalizePlayback = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(Number.isFinite(video.duration) ? video.duration : video.currentTime);
    }
    setPlaying(false);
    // endedRef 是幂等锁：onTimeUpdate、原生 ended 事件、onPlayStateChange 都可能触发
    // finalizePlayback，这里保证收尾逻辑（尤其是 stopRecorder）只真正执行一次
    if (endedRef.current) return;
    endedRef.current = true;
    stopRecorder(phase === "recognizing");
  }, [phase, stopRecorder]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    // 提前 0.2 秒判定"播放结束"，而不是死等原生 ended 事件——
    // 部分浏览器/编码下 timeupdate 在接近末尾时会跳过或延迟，ended 事件时机不够可靠
    if (
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime >= video.duration - 0.2
    ) {
      finalizePlayback();
    }
  };

  const onPlayStateChange = (nextPlaying: boolean) => {
    const video = videoRef.current;
    setPlaying(nextPlaying);
    const recorder = mediaRecorderRef.current;

    if (nextPlaying) {
      if (endedRef.current) {
        endedRef.current = false;
      }
      if (recorder?.state === "paused") {
        recorder.resume();
      }
    } else if (video?.ended || (duration > 0 && video && video.currentTime >= duration - 0.2)) {
      finalizePlayback();
    } else if (phase === "recognizing" && video) {
      // 识别过程中不允许用户暂停视频（暂停了字幕就对不上音频进度了），
      // 检测到暂停就强制续播；这也是 VideoPanel 的 locked 属性存在的原因
      void video.play().catch(() => undefined);
    } else if (recorder?.state === "recording") {
      recorder.pause();
    }
  };

  const onStartRecognition = async () => {
    const video = videoRef.current;
    if (!video || !videoUrl || phase !== "loaded") return;

    stopRecorder();
    endedRef.current = false;
    setSubtitles([]);
    setTranscribePending(0);
    setRecorderFinalizing(false);
    setAnalysisPhase("none");
    setAnalysisError("");
    setAnalysisStep(0);
    setAnalysisData(EMPTY_ANALYSIS);
    setThread([]);
    setCurrentTime(0);
    video.currentTime = 0;
    setPhase("recognizing");

    try {
      await video.play();
      startRecorder();
    } catch {
      setPlaying(false);
      setPhase("loaded");
    }
  };

  const onEnded = () => {
    finalizePlayback();
  };

  const onVideoError = () => {
    if (videoIndex + 1 < videoUrls.length) {
      setVideoIndex((idx) => idx + 1);
    }
  };

  // 视频播完 + 所有分片转写请求都返回 + 录音器收尾完成，三个条件同时满足才能真正进入"已识别"状态；
  // setTimeout(..., 0) 是刻意推迟到下一个 tick，避免和触发这次 effect 的那次状态更新挤在同一渲染周期
  useEffect(() => {
    if (!endedRef.current || transcribePending > 0 || recorderFinalizing) return;
    if (phase === "recognizing") {
      const timer = window.setTimeout(() => setPhase("recognized"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [phase, recorderFinalizing, transcribePending]);

  const startAnalysis = useCallback(async () => {
    if (phase !== "recognized" || subtitles.length === 0 || analysisPhase !== "none") return;

    setAnalysisPhase("analyzing");
    setAnalysisStep(0);

    // 这两个定时器只是给骨架屏做渐进式的假进度效果，和 /api/analyze 请求的真实进度无关；
    // 如果请求提前返回，下面 finally 里会统一清掉，UI 上会有一次跳跃
    const stepTimers = [
      window.setTimeout(() => setAnalysisStep(1), 500),
      window.setTimeout(() => setAnalysisStep(2), 1200),
    ];

    try {
      const res = await authedFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtitles,
          videoUrls,
          videoIndex,
          durationSec: duration,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        setAnalysisError(data?.detail || data?.error || "分析接口请求失败");
        setAnalysisPhase("failed");
        return;
      }

      const data = (await res.json()) as AnalyzeResponse;
      setAnalysisData(adaptAnalysis(data, duration));
      setAnalysisStep(3);
      setAnalysisError("");
      setAnalysisPhase("done");
    } finally {
      stepTimers.forEach(window.clearTimeout);
    }
  }, [analysisPhase, authedFetch, duration, phase, subtitles, videoIndex, videoUrls]);

  const onSend = async (q: string) => {
    const history = thread
      .flatMap((m) => {
        if (!m.a) return [{ role: "user" as const, content: m.q }];
        return [
          { role: "user" as const, content: m.q },
          { role: "assistant" as const, content: m.a },
        ];
      })
      .slice(-20);

    // 先记下这条问题在数组里的下标，占位插入一条"回答中"的消息；
    // 等接口返回后再按这个下标去更新对应那一条，而不是默认它一定是最后一条
    // （避免用户在等待期间又发了新问题导致下标错位）
    const index = thread.length;
    setThread((items) => [...items, { q, a: null }]);
    setAskPending(true);

    try {
      const res = await authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history,
          subtitles,
          analysis: analysisData,
        }),
      });
      const data = res.ok ? ((await res.json()) as { answer?: string }) : { answer: "" };
      setThread((items) => items.map((m, i) => (i === index ? { ...m, a: data.answer || "" } : m)));
    } finally {
      setAskPending(false);
    }
  };

  const onSuggest = useCallback(
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

  const recognizedCount = subtitles.length;
  // 找到"时间点 <= 当前播放时间"的最后一条字幕，依赖 subtitles 已按 t 升序排列
  // （排序发生在 sendAudioChunk 合并新分片时），一旦遇到未来的字幕就提前退出循环
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < subtitles.length; i++) {
      if (subtitles[i].t <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [currentTime, subtitles]);
  const activeSub = activeIdx >= 0 ? subtitles[activeIdx] : null;

  return (
    <div className="app">
      <TopBar
        phase={phase}
        url={url}
        setUrl={setUrl}
        onParse={onParse}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <div className="main">
        <VideoPanel
          phase={phase}
          sub={activeSub}
          videoRef={videoRef}
          videoUrl={videoUrl}
          coverUrl={coverUrl}
          currentTime={currentTime}
          duration={duration}
          playing={playing}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onPlayStateChange={onPlayStateChange}
          onVideoError={onVideoError}
          locked={phase === "recognizing"}
        />
        <SubtitlePanel
          phase={phase}
          subtitles={subtitles}
          recognizedCount={recognizedCount}
          activeIdx={activeIdx}
          recogClock={currentTime}
          onSeek={onSeek}
          onStartRecognition={onStartRecognition}
        />
        <AnalysisPanel
          phase={phase}
          analysisPhase={analysisPhase}
          analysisStep={analysisStep}
          analysisError={analysisError}
          data={analysisData}
          durationSec={duration}
          products={products}
          setProducts={setProducts}
          thread={thread}
          onSend={onSend}
          onSuggest={onSuggest}
          askPending={askPending}
          onStartAnalysis={startAnalysis}
        />
      </div>
    </div>
  );
}
