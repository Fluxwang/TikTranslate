'use client';

import { useRef } from 'react';

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';

interface Subtitle {
  t: number;
  es: string;
  zh: string;
}

interface Props {
  phase: Phase;
  sub: Subtitle | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  coverUrl: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onPlayStateChange: (playing: boolean) => void;
  onVideoError: () => void;
}

function fmtTime(sec: number) {
  sec = Math.max(0, Math.floor(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

export default function VideoPanel({
  phase,
  sub,
  videoRef,
  videoUrl,
  coverUrl,
  currentTime,
  duration,
  playing,
  onTogglePlay,
  onSeek,
  onLoadedMetadata,
  onTimeUpdate,
  onEnded,
  onPlayStateChange,
  onVideoError,
}: Props) {
  const loaded = phase === 'loaded' || phase === 'recognizing' || phase === 'recognized';
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = duration ? (currentTime / duration) * 100 : 0;

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(ratio * duration);
  };

  return (
    <section className="col">
      <div className="col-head">
        <span className="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          </svg>
          视频
        </span>
      </div>

      <div className="video-stage">
        <div className="video-frame">
          <div className={`video-placeholder${loaded ? ' playing' : ''}`}>
            {!loaded && (
              <>
                <div className="pp-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" style={{ marginLeft: 2 }}>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </div>
                <div className="pp-label">creator video</div>
              </>
            )}
          </div>

          {videoUrl && (
            <video
              ref={videoRef}
              className="video-el"
              src={videoUrl}
              poster={coverUrl || undefined}
              crossOrigin="anonymous"
              playsInline
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => onPlayStateChange(true)}
              onPause={() => onPlayStateChange(false)}
              onEnded={onEnded}
              onError={onVideoError}
            />
          )}

          <div className={`video-rail${loaded ? ' on' : ''}`}>
            <div className="r">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <div className="r">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="r">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </div>
          </div>

          {loaded && sub && (
            <div className="sub-overlay">
              <div className="src fade-in" key={'s' + sub.t}>{sub.es}</div>
              <div className="dst fade-in" key={'d' + sub.t}>{sub.zh}</div>
            </div>
          )}
        </div>
      </div>

      <div className="video-controls">
        <button className={`play${loaded ? '' : ' disabled'}`} disabled={!loaded} onClick={onTogglePlay}>
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" style={{ marginLeft: 1 }}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
        <div className="track" ref={trackRef} onClick={seekFromEvent}>
          <div className="fill" style={{ width: pct + '%' }} />
          <div className="knob" style={{ left: pct + '%' }} />
        </div>
        <span className="time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
        <button className="vol-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
      </div>
    </section>
  );
}

export { fmtTime };
