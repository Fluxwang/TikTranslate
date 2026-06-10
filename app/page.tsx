'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import VideoPanel from '@/components/VideoPanel';
import SubtitlePanel from '@/components/SubtitlePanel';
import AnalysisPanel from '@/components/AnalysisPanel';
import { adaptAnalysis, EMPTY_ANALYSIS, loadProducts, saveProducts } from '@/lib/analysis';
import type { AnalysisData, AnalysisPhase, AnalyzeResponse, Phase, Product, Subtitle } from '@/lib/types';

type TikHubResponse = {
  videoUrls: string[];
  author: string;
  durationSec: number;
  coverUrl: string;
};

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderTimerRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const chunkStartRef = useRef(0);
  const endedRef = useRef(false);

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [sourceLang, setSourceLang] = useState('es');
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoIndex, setVideoIndex] = useState(0);
  const [coverUrl, setCoverUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [transcribePending, setTranscribePending] = useState(0);
  const [recorderFinalizing, setRecorderFinalizing] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('none');
  const [analysisError, setAnalysisError] = useState('');
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisData, setAnalysisData] = useState<AnalysisData>(EMPTY_ANALYSIS);
  const [thread, setThread] = useState<{ q: string; a: string | null }[]>([]);
  const [askPending, setAskPending] = useState(false);
  const [products, setProducts] = useState<Product[]>(() => loadProducts());

  const videoUrl = videoUrls[videoIndex] ?? '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    saveProducts(products);
  }, [products]);

  useEffect(() => {
    const token = window.localStorage.getItem('tt_token');
    if (!token) router.replace('/login');
  }, [router]);

  const authedFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = window.localStorage.getItem('tt_token');
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(input, { ...init, headers });
    if (res.status === 401) {
      window.localStorage.removeItem('tt_token');
      router.replace('/login');
    }
    return res;
  }, [router]);

  const stopRecorder = useCallback((finalizing = false) => {
    if (recorderTimerRef.current != null) {
      window.clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (finalizing) setRecorderFinalizing(true);
      if (recorder.state === 'paused') {
        recorder.resume();
      }
      recorder.stop();
    } else if (finalizing) {
      setRecorderFinalizing(false);
    }
    mediaRecorderRef.current = null;
    audioStreamRef.current = null;
  }, []);

  const sendAudioChunk = useCallback(async (blob: Blob, startOffset: number) => {
    if (blob.size === 0) return;

    setTranscribePending((n) => n + 1);
    try {
      const form = new FormData();
      form.set('audio', blob, 'chunk.webm');
      form.set('startOffset', String(startOffset));
      form.set('sourceLang', sourceLang);

      const res = await authedFetch('/api/transcribe', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) return;

      const data = await res.json() as { segments?: Subtitle[] };
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        setSubtitles((items) => [...items, ...data.segments!].sort((a, b) => a.t - b.t));
      }
    } finally {
      setTranscribePending((n) => Math.max(0, n - 1));
    }
  }, [authedFetch, sourceLang]);

  const startRecorder = useCallback(() => {
    const video = videoRef.current;
    if (!video || mediaRecorderRef.current || recorderTimerRef.current != null) return;

    const getAudioStream = () => {
      if (audioStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live')) {
        return audioStreamRef.current;
      }

      const captureStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
      const stream = captureStream?.call(video);
      if (!stream || stream.getAudioTracks().length === 0) return null;

      audioStreamRef.current = new MediaStream(stream.getAudioTracks());
      return audioStreamRef.current;
    };

    const startChunkRecorder = () => {
      const audioOnly = getAudioStream();
      if (!audioOnly || mediaRecorderRef.current) return;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType ? new MediaRecorder(audioOnly, { mimeType }) : new MediaRecorder(audioOnly);
      chunkStartRef.current = video.currentTime;

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
      setPhase('recognizing');
    };

    startChunkRecorder();
    recorderTimerRef.current = window.setInterval(() => {
      const recorder = mediaRecorderRef.current;
      const currentVideo = videoRef.current;
      if (!currentVideo || currentVideo.paused || currentVideo.ended || recorder?.state !== 'recording') return;

      recorder.stop();
      mediaRecorderRef.current = null;
      window.setTimeout(startChunkRecorder, 0);
    }, 15_000);
  }, [sendAudioChunk]);

  const onParse = async () => {
    if (!url.trim()) return;

    stopRecorder();
    endedRef.current = false;
    setPhase('parsing');
    setCurrentTime(0);
    setPlaying(false);
    setSubtitles([]);
    setTranscribePending(0);
    setRecorderFinalizing(false);
    setAnalysisPhase('none');
    setAnalysisError('');
    setAnalysisStep(0);
    setAnalysisData(EMPTY_ANALYSIS);
    setThread([]);
    setVideoUrls([]);
    setVideoIndex(0);
    setCoverUrl('');
    setDuration(0);

    const res = await authedFetch('/api/tikhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });

    if (!res.ok) {
      setPhase('idle');
      return;
    }

    const data = await res.json() as TikHubResponse;
    setVideoUrls(data.videoUrls);
    setCoverUrl(data.coverUrl);
    setDuration(data.durationSec || 0);
    setPhase('loaded');
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!videoUrl || !video) return;
    video.load();
  }, [videoUrl]);

  const onTogglePlay = () => {
    const video = videoRef.current;
    if (!video || !videoUrl || phase === 'recognizing') return;
    if (video.ended || (duration > 0 && video.currentTime >= duration)) {
      video.currentTime = 0;
    }
    if (video.paused) void video.play();
    else video.pause();
  };

  const onSeek = (sec: number) => {
    const video = videoRef.current;
    if (!video || phase === 'recognizing') return;
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
    if (endedRef.current) return;
    endedRef.current = true;
    stopRecorder(phase === 'recognizing');
  }, [phase, stopRecorder]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.2) {
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
      if (recorder?.state === 'paused') {
        recorder.resume();
      }
    } else if (video?.ended || (duration > 0 && video && video.currentTime >= duration - 0.2)) {
      finalizePlayback();
    } else if (phase === 'recognizing' && video) {
      void video.play().catch(() => undefined);
    } else if (recorder?.state === 'recording') {
      recorder.pause();
    }
  };

  const onStartRecognition = async () => {
    const video = videoRef.current;
    if (!video || !videoUrl || phase !== 'loaded') return;

    stopRecorder();
    endedRef.current = false;
    setSubtitles([]);
    setTranscribePending(0);
    setRecorderFinalizing(false);
    setAnalysisPhase('none');
    setAnalysisError('');
    setAnalysisStep(0);
    setAnalysisData(EMPTY_ANALYSIS);
    setThread([]);
    setCurrentTime(0);
    video.currentTime = 0;
    setPhase('recognizing');

    try {
      await video.play();
      startRecorder();
    } catch {
      setPlaying(false);
      setPhase('loaded');
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

  useEffect(() => {
    if (!endedRef.current || transcribePending > 0 || recorderFinalizing) return;
    if (phase === 'recognizing') {
      const timer = window.setTimeout(() => setPhase('recognized'), 0);
      return () => window.clearTimeout(timer);
    }
  }, [phase, recorderFinalizing, transcribePending]);

  const startAnalysis = useCallback(async () => {
    if (subtitles.length === 0 || analysisPhase !== 'none') return;

    setAnalysisPhase('analyzing');
    setAnalysisStep(0);

    const stepTimers = [
      window.setTimeout(() => setAnalysisStep(1), 500),
      window.setTimeout(() => setAnalysisStep(2), 1200),
    ];

    try {
      const res = await authedFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles, sourceLang }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; detail?: string } | null;
        setAnalysisError(data?.detail || data?.error || '分析接口请求失败');
        setAnalysisPhase('failed');
        return;
      }

      const data = await res.json() as AnalyzeResponse;
      setAnalysisData(adaptAnalysis(data, duration));
      setAnalysisStep(3);
      setAnalysisError('');
      setAnalysisPhase('done');
    } finally {
      stepTimers.forEach(window.clearTimeout);
    }
  }, [analysisPhase, authedFetch, duration, sourceLang, subtitles]);

  useEffect(() => {
    if (phase === 'recognized' && analysisPhase === 'none') {
      const timer = window.setTimeout(() => {
        void startAnalysis();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [analysisPhase, phase, startAnalysis]);

  const onSend = async (q: string) => {
    const history = thread.flatMap((m) => {
      if (!m.a) return [{ role: 'user' as const, content: m.q }];
      return [
        { role: 'user' as const, content: m.q },
        { role: 'assistant' as const, content: m.a },
      ];
    }).slice(-20);

    const index = thread.length;
    setThread((items) => [...items, { q, a: null }]);
    setAskPending(true);

    try {
      const res = await authedFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history,
          subtitles,
          sourceLang,
          analysis: analysisData,
        }),
      });
      const data = res.ok ? await res.json() as { answer?: string } : { answer: '' };
      setThread((items) => items.map((m, i) => (i === index ? { ...m, a: data.answer || '' } : m)));
    } finally {
      setAskPending(false);
    }
  };

  const recognizedCount = subtitles.length;
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
        sourceLang={sourceLang}
        setSourceLang={setSourceLang}
        onParse={onParse}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
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
          locked={phase === 'recognizing'}
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
          askPending={askPending}
        />
      </div>
    </div>
  );
}
