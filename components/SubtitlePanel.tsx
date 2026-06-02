'use client';

import { useEffect, useRef } from 'react';
import { fmtTime } from './VideoPanel';

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';

interface Subtitle {
  t: number;
  es: string;
  zh: string;
}

interface Props {
  phase: Phase;
  subtitles: readonly Subtitle[];
  recognizedCount: number;
  activeIdx: number;
  recogClock: number;
  onSeek: (sec: number) => void;
  onStartRecognition: () => void;
}

export default function SubtitlePanel({
  phase,
  subtitles,
  recognizedCount,
  activeIdx,
  recogClock,
  onSeek,
  onStartRecognition,
}: Props) {
  const idle = phase === 'idle' || phase === 'parsing';
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = listRef.current, a = activeRef.current;
    if (!c || !a) return;
    const target = a.offsetTop - c.clientHeight / 2 + a.clientHeight / 2;
    c.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIdx]);

  const total = subtitles.length;
  const skeletonCount = phase === 'recognizing' ? Math.min(3, total - recognizedCount) : 0;

  return (
    <section className="col">
      <div className="col-head">
        <span className="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          字幕
        </span>
        <div className="actions">
          <button className="icon-btn" title="下载字幕 (.srt)"
            disabled={phase !== 'recognized'} style={phase !== 'recognized' ? { opacity: 0.4 } : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {idle ? (
        <div className="empty">
          <div className="ei">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="et">字幕将在这里出现</div>
          <div className="es">解析视频后，西语语音将被实时识别并翻译成中文。</div>
        </div>
      ) : (
        <div className="sub-list" ref={listRef}>
          {total === 0 && (
            <div className="empty">
              <div className="ei">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="et">
                {phase === 'recognized' ? '未识别到字幕' : phase === 'loaded' ? '待识别' : '等待第一段字幕'}
              </div>
              <div className="es">
                {phase === 'recognized'
                  ? '转写接口已结束，但没有返回可显示的文本。'
                  : phase === 'loaded'
                    ? '点击开始识别后，将锁定播放器并从头生成字幕。'
                    : '视频播放后会按音频分片逐段生成字幕。'}
              </div>
            </div>
          )}
          {subtitles.slice(0, recognizedCount).map((s, i) => (
            <div
              key={i}
              ref={i === activeIdx ? activeRef : null}
              className={`sub-row${i === activeIdx ? ' active' : ''}`}
              onClick={() => onSeek(s.t)}
            >
              <span className="ts">{fmtTime(s.t)}</span>
              <div className="lines">
                <div className="src">{s.es}</div>
                <div className="dst">{s.zh}</div>
              </div>
            </div>
          ))}
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div className="sk-row" key={'sk' + i}>
              <span className="ts" />
              <div className="lines" style={{ flex: 1 }}>
                <div className="sk-line" style={{ width: (70 - i * 12) + '%' }} />
                <div className="sk-line" style={{ width: (90 - i * 10) + '%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!idle && (
        <div className="sub-status">
          {phase === 'recognized' ? (
            <>
              <span className="dot done" />
              识别完成
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="sub-status-spacer" />
              <button className="sub-action" disabled>已完成</button>
            </>
          ) : phase === 'loaded' ? (
            <>
              <span className="dot ready" />
              待识别
              <span className="sub-status-spacer" />
              <button className="sub-action" onClick={onStartRecognition}>开始识别</button>
            </>
          ) : (
            <>
              <span className="dot live" />
              识别中...
              <span className="mono">{fmtTime(recogClock)}</span>
              <span className="sub-status-spacer" />
              <button className="sub-action" disabled>识别中</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
