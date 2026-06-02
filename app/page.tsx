'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/TopBar';
import VideoPanel from '@/components/VideoPanel';
import SubtitlePanel from '@/components/SubtitlePanel';
import AnalysisPanel from '@/components/AnalysisPanel';

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';
type AnalysisPhase = 'none' | 'analyzing' | 'done';

type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

type AnalysisData = {
  sellingPoints: string[];
  scores: { dim: string; val: number; pct: number }[];
  summary: string;
  suggestedQuestions: string[];
};

type TikHubResponse = {
  videoUrls: string[];
  author: string;
  durationSec: number;
  coverUrl: string;
};

const EMPTY_ANALYSIS: AnalysisData = {
  sellingPoints: [],
  scores: [
    { dim: '说服力', val: 0, pct: 0 },
    { dim: '钩子强度', val: 0, pct: 0 },
    { dim: '爆款潜力', val: 0, pct: 0 },
  ],
  summary: '',
  suggestedQuestions: [],
};

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkStartRef = useRef(0);
  const endedRef = useRef(false);

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
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
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisData, setAnalysisData] = useState<AnalysisData>(EMPTY_ANALYSIS);
  const [thread, setThread] = useState<{ q: string; a: string | null }[]>([]);
  const [askPending, setAskPending] = useState(false);

  const videoUrl = videoUrls[videoIndex] ?? '';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (finalizing) setRecorderFinalizing(true);
      recorder.stop();
    } else if (finalizing) {
      setRecorderFinalizing(false);
    }
    mediaRecorderRef.current = null;
  }, []);

  const sendAudioChunk = useCallback(async (blob: Blob, startOffset: number) => {
    if (blob.size === 0) return;

    setTranscribePending((n) => n + 1);
    try {
      const form = new FormData();
      form.set('audio', blob, 'chunk.webm');
      form.set('startOffset', String(startOffset));
      form.set('sourceLang', 'es');

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
  }, [authedFetch]);

  const startRecorder = useCallback(() => {
    const video = videoRef.current;
    if (!video || mediaRecorderRef.current) return;

    const captureStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    const stream = captureStream?.call(video);
    if (!stream || stream.getAudioTracks().length === 0) return;

    const audioOnly = new MediaStream(stream.getAudioTracks());
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const recorder = mimeType ? new MediaRecorder(audioOnly, { mimeType }) : new MediaRecorder(audioOnly);
    chunkStartRef.current = video.currentTime;

    recorder.ondataavailable = (event) => {
      const startOffset = chunkStartRef.current;
      chunkStartRef.current = video.currentTime;
      void sendAudioChunk(event.data, startOffset);
    };
    recorder.onstop = () => setRecorderFinalizing(false);
    recorder.start(15_000);
    mediaRecorderRef.current = recorder;
    setPhase('recognizing');
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
    void video.play().catch(() => setPlaying(false));
  }, [videoUrl]);

  const onTogglePlay = () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (video.ended || (duration > 0 && video.currentTime >= duration)) {
      video.currentTime = 0;
    }
    if (video.paused) void video.play();
    else video.pause();
  };

  const onSeek = (sec: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(duration || video.duration || sec, Math.max(0, sec));
    void video.play();
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : duration);
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  };

  const onPlayStateChange = (nextPlaying: boolean) => {
    setPlaying(nextPlaying);
    const recorder = mediaRecorderRef.current;

    if (nextPlaying) {
      if (!recorder) {
        startRecorder();
      } else if (recorder.state === 'paused') {
        recorder.resume();
      }
    } else if (recorder?.state === 'recording') {
      recorder.pause();
    }
  };

  const onEnded = () => {
    setPlaying(false);
    endedRef.current = true;
    stopRecorder(true);
  };

  const onVideoError = () => {
    if (videoIndex + 1 < videoUrls.length) {
      setVideoIndex((idx) => idx + 1);
    }
  };

  useEffect(() => {
    if (!endedRef.current || transcribePending > 0 || recorderFinalizing) return;
    if (phase === 'loaded' || phase === 'recognizing') {
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
        body: JSON.stringify({ subtitles }),
      });

      if (!res.ok) {
        setAnalysisPhase('none');
        return;
      }

      const data = await res.json() as AnalysisData;
      setAnalysisData(data);
      setAnalysisStep(3);
      setAnalysisPhase('done');
    } finally {
      stepTimers.forEach(window.clearTimeout);
    }
  }, [analysisPhase, authedFetch, subtitles]);

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
        />
        <SubtitlePanel
          phase={phase}
          subtitles={subtitles}
          recognizedCount={recognizedCount}
          activeIdx={activeIdx}
          recogClock={currentTime}
          onSeek={onSeek}
        />
        <AnalysisPanel
          phase={phase}
          analysisPhase={analysisPhase}
          analysisStep={analysisStep}
          data={analysisData}
          thread={thread}
          onSend={onSend}
          askPending={askPending}
        />
      </div>
    </div>
  );
}
