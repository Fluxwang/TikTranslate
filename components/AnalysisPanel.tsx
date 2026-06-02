'use client';

import { useState } from 'react';

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';
type AnalysisPhase = 'none' | 'analyzing' | 'done';

interface AnalysisData {
  sellingPoints: readonly string[];
  scores: readonly { dim: string; val: number; pct: number }[];
  summary: string;
  suggestedQuestions: readonly string[];
}

interface Props {
  phase: Phase;
  analysisPhase: AnalysisPhase;
  analysisStep: number;
  data: AnalysisData;
  thread: { q: string; a: string | null }[];
  onSend: (q: string) => void;
  askPending: boolean;
}

function CardSkeleton({ lines }: { lines: number }) {
  return <div>{Array.from({ length: lines }).map((_, i) => <div className="sk-block" key={i} style={{ width: `${95 - i * 14}%` }} />)}</div>;
}

function SellingPoints({ data }: { data: AnalysisData }) {
  return <div className="tag-group">{data.sellingPoints.map((p, i) => <span className="pill" key={i}>{p}</span>)}</div>;
}

function Scores({ data, animate }: { data: AnalysisData; animate: boolean }) {
  return (
    <div>
      {data.scores.map((s, i) => (
        <div className="score-row" key={i}>
          <span className="dim">{s.dim}</span>
          <div className="score-bar"><div className="fill" style={{ width: animate ? `${s.pct}%` : 0 }} /></div>
          <span className="val">{s.val}</span>
        </div>
      ))}
    </div>
  );
}

function AskBox({ data, thread, onSend, pending }: { data: AnalysisData; thread: { q: string; a: string | null }[]; onSend: (q: string) => void; pending: boolean }) {
  const [val, setVal] = useState('');
  const [focused, setFocused] = useState(false);

  const submit = (text?: string) => {
    const q = (text ?? val).trim();
    if (!q || pending) return;
    onSend(q);
    setVal('');
  };

  return (
    <div className="card" style={{ padding: 0, background: 'transparent', border: 'none' }}>
      <div className="card-head" style={{ padding: '0 1px 9px' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        <span className="t">追问 AI</span>
      </div>

      {thread.length > 0 && (
        <div className="ask-thread" style={{ padding: '0 0 10px' }}>
          {thread.map((m, i) => (
            <div key={i}>
              <div className="ask-msg q">{m.q}</div>
              <div className="ask-msg a" style={{ marginTop: 4 }}>
                <span className="who">AI</span>
                {m.a == null ? <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : m.a}
              </div>
            </div>
          ))}
        </div>
      )}

      {thread.length === 0 && (
        <div className="ask-chips">
          {data.suggestedQuestions.map((q, i) => <button className="ask-chip" key={i} onClick={() => submit(q)}>{q}</button>)}
        </div>
      )}

      <div className={`ask${focused ? ' focused' : ''}`}>
        <div className="ask-input-row">
          <textarea
            rows={1}
            value={val}
            placeholder="追问 AI..."
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setVal(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(80, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button className={`send${val.trim() ? ' ready' : ''}`} onClick={() => submit()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnalysisPanel({ phase, analysisPhase, analysisStep, data, thread, onSend, askPending }: Props) {
  const started = analysisPhase !== 'none';

  return (
    <section className="col">
      <div className="col-head">
        <span className="label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 3l1.912 5.813H20l-4.956 3.562L16.912 18 12 14.438 7.088 18l1.868-5.625L4 8.813h6.088L12 3z" /></svg>
          AI 分析
        </span>
        <div className="actions">
          {!started ? (
            <button className="btn btn-ghost" style={{ height: 26, padding: '0 10px', fontSize: 11 }} disabled>等待字幕</button>
          ) : analysisPhase === 'analyzing' ? (
            <button className="btn btn-ghost" style={{ height: 26, padding: '0 10px', fontSize: 11 }} disabled>
              <span className="spinner" /> 分析中
            </button>
          ) : (
            <span className="beta" style={{ textTransform: 'none' }}>已完成</span>
          )}
        </div>
      </div>

      {!started ? (
        <div className="empty">
          <div className="ei">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><path d="M12 3l1.912 5.813H20l-4.956 3.562L16.912 18 12 14.438 7.088 18l1.868-5.625L4 8.813h6.088L12 3z" /></svg>
          </div>
          <div className="et">{phase === 'recognized' ? '字幕已就绪' : '等待字幕识别完成'}</div>
          <div className="es">{phase === 'recognized' ? 'AI 将自动提取卖点、给视频打分并总结话术。' : '识别完成后即可对达人话术进行卖点、评分与摘要分析。'}</div>
        </div>
      ) : (
        <div className="ai-body">
          <div className="card enter">
            <div className="card-head"><span className="t">核心卖点</span></div>
            {analysisStep >= 1 ? <SellingPoints data={data} /> : <CardSkeleton lines={2} />}
          </div>
          <div className="card enter">
            <div className="card-head"><span className="t">内容评分</span></div>
            {analysisStep >= 2 ? <Scores data={data} animate /> : <CardSkeleton lines={3} />}
          </div>
          <div className="card enter">
            <div className="card-head"><span className="t">话术摘要</span></div>
            {analysisStep >= 3 ? <p className="summary">{data.summary}</p> : <CardSkeleton lines={4} />}
          </div>
          {analysisPhase === 'done' && <AskBox data={data} thread={thread} onSend={onSend} pending={askPending} />}
        </div>
      )}
    </section>
  );
}
