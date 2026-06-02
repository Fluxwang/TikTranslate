'use client';

import { useState, useEffect, useRef } from 'react';
import { DEMO_DATA } from '@/lib/demo-data';
import TopBar from '@/components/TopBar';
import VideoPanel from '@/components/VideoPanel';
import SubtitlePanel from '@/components/SubtitlePanel';
import AnalysisPanel from '@/components/AnalysisPanel';

const PLAYBACK_RATE = 1.5;
const RECOG_RATE = 5;

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';
type AnalysisPhase = 'none' | 'analyzing' | 'done';

export default function Home() {
  const data = DEMO_DATA;
  const subtitles = data.subtitles;
  const duration = data.meta.durationSec;

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recogClock, setRecogClock] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('none');
  const [analysisStep, setAnalysisStep] = useState(0);
  const [thread, setThread] = useState<{ q: string; a: string | null }[]>([]);
  const [askPending, setAskPending] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRef = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const recognizedCount =
    phase === 'idle' || phase === 'parsing'
      ? 0
      : subtitles.filter((s) => s.t <= recogClock).length;

  let activeIdx = -1;
  for (let i = 0; i < recognizedCount; i++) {
    if (subtitles[i].t <= currentTime) activeIdx = i;
    else break;
  }
  const activeSub = activeIdx >= 0 ? subtitles[activeIdx] : null;

  useEffect(() => {
    if (phase === 'idle' || phase === 'parsing') return;
    lastRef.current = performance.now();
    timerRef.current = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (playing) {
        setCurrentTime((c) => {
          const n = c + dt * PLAYBACK_RATE;
          if (n >= duration) { setPlaying(false); return duration; }
          return n;
        });
      }
      setRecogClock((r) => {
        if (r >= duration) return r;
        return Math.min(duration + 1, r + dt * RECOG_RATE);
      });
    }, 1000 / 30);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, playing, duration]);

  useEffect(() => {
    if ((phase === 'recognizing' || phase === 'loaded') && recognizedCount >= subtitles.length) {
      setPhase('recognized');
    } else if (phase === 'loaded' && recognizedCount > 0) {
      setPhase('recognizing');
    }
  }, [recognizedCount, phase, subtitles.length]);

  const onParse = () => {
    if (!url.trim()) return;
    setPhase('parsing');
    setCurrentTime(0); setRecogClock(0); setPlaying(false);
    setAnalysisPhase('none'); setAnalysisStep(0); setThread([]);
    setTimeout(() => { setPhase('loaded'); setPlaying(true); }, 1400);
  };

  const onTogglePlay = () => {
    if (currentTime >= duration) setCurrentTime(0);
    setPlaying((p) => !p);
  };
  const onSeek = (sec: number) => {
    setCurrentTime(Math.min(duration, Math.max(0, sec)));
    setPlaying(true);
  };

  const onStartAnalysis = () => {
    setAnalysisPhase('analyzing');
    setAnalysisStep(0);
    setTimeout(() => setAnalysisStep(1), 600);
    setTimeout(() => setAnalysisStep(2), 1500);
    setTimeout(() => setAnalysisStep(3), 2400);
    setTimeout(() => setAnalysisPhase('done'), 2800);
  };

  const onSend = (q: string) => {
    setThread((th) => [...th, { q, a: null }]);
    setAskPending(true);
    setTimeout(() => {
      const answers = data.analysis.answers as Record<string, string>;
      const a = answers[q] ?? data.analysis.defaultAnswer;
      setThread((th) => th.map((m, i) => (i === th.length - 1 ? { ...m, a } : m)));
      setAskPending(false);
    }, 1100);
  };

  return (
    <div className="app">
      <TopBar
        phase={phase} url={url} setUrl={setUrl} onParse={onParse}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
      <div className="main">
        <VideoPanel
          phase={phase} sub={activeSub} currentTime={currentTime} duration={duration}
          playing={playing} onTogglePlay={onTogglePlay} onSeek={onSeek}
        />
        <SubtitlePanel
          phase={phase} subtitles={subtitles as typeof subtitles} recognizedCount={recognizedCount}
          activeIdx={activeIdx} recogClock={recogClock} onSeek={onSeek}
        />
        <AnalysisPanel
          phase={phase} analysisPhase={analysisPhase} analysisStep={analysisStep}
          data={data.analysis} onStart={onStartAnalysis}
          thread={thread} onSend={onSend} askPending={askPending}
        />
      </div>
    </div>
  );
}
