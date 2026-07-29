"use client";

import { useRef } from "react";
import { formatTime } from "@/lib/format";

// 与 lib/types.ts 里的 Phase / Subtitle 是同一份定义，这里手写了一份本地副本
// （历史遗留，未统一 import），改字段时要记得同步过去
type Phase = "idle" | "parsing" | "loaded" | "recognizing" | "recognized";

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
  locked: boolean;
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
  locked,
}: Props) {
  const loaded = phase === "loaded" || phase === "recognizing" || phase === "recognized";
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = duration ? (currentTime / duration) * 100 : 0;

  // 把鼠标点击的绝对坐标换算成进度条上的百分比：(点击位置 - 进度条左边界) / 进度条总宽度，
  // 再夹在 [0, 1] 之间防止点在条外
  const seekFromEvent = (e: React.MouseEvent) => {
    if (locked) return;
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
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="14"
            height="14"
          >
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          </svg>
          视频
        </span>
      </div>

      <div className="video-stage">
        <div className="video-frame">
          <div className={`video-placeholder${loaded ? " playing" : ""}`}>
            {!loaded && (
              <>
                <div className="pp-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="24"
                    height="24"
                    style={{ marginLeft: 2 }}
                  >
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

          <div className={`video-rail${loaded ? " on" : ""}`}>
            <div className="r">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="15"
                height="15"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <div className="r">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="15"
                height="15"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="r">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="15"
                height="15"
              >
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
            </div>
          </div>

          {loaded && sub && (
            // key 里带上 sub.t：字幕切换时 key 变化会让 React 卸载再重新挂载这个节点，
            // 从而重新触发一次 fade-in 动画，而不是复用旧节点导致动画不重放
            <div className="sub-overlay">
              <div className="src fade-in" key={"s" + sub.t}>
                {sub.es}
              </div>
              <div className="dst fade-in" key={"d" + sub.t}>
                {sub.zh}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* locked 在字幕识别阶段为 true：识别依赖视频连续播放来对齐音频分片时间戳，
          这段时间禁止用户暂停/拖动进度条，具体状态机逻辑在 app/page.tsx 里 */}
      <div className="video-controls">
        <button
          className={`play${loaded && !locked ? "" : " disabled"}`}
          disabled={!loaded || locked}
          onClick={onTogglePlay}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="15"
              height="15"
              style={{ marginLeft: 1 }}
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
        <div className={`track${locked ? " locked" : ""}`} ref={trackRef} onClick={seekFromEvent}>
          <div className="fill" style={{ width: pct + "%" }} />
          <div className="knob" style={{ left: pct + "%" }} />
        </div>
        <span className="time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button className="vol-btn">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="16"
            height="16"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
      </div>
    </section>
  );
}
