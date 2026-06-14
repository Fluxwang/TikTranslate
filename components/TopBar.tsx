'use client';

import { useState } from 'react';

type Phase = 'idle' | 'parsing' | 'loaded' | 'recognizing' | 'recognized';

interface Props {
  phase: Phase;
  url: string;
  setUrl: (v: string) => void;
  onParse: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function TopBar({ phase, url, setUrl, onParse, theme, onToggleTheme }: Props) {
  const [focused, setFocused] = useState(false);
  const parsing = phase === 'parsing';
  const canParse = url.trim().length > 0 && !parsing;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">T</span>
        <b>TikTranslate</b>
      </div>

      <div className={`url-wrap${focused ? ' focused' : ''}${parsing ? ' disabled' : ''}`}>
        <svg className="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <input
          value={url}
          disabled={parsing}
          placeholder="粘贴 TikTok 链接..."
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canParse) onParse(); }}
        />
      </div>

      <div className="topbar-right">
        <button className="btn btn-primary" disabled={!canParse} onClick={onParse}>
          {parsing ? <><span className="spinner" /> 解析中</> : '解析'}
        </button>
        <span className="beta">beta</span>
        <button className="icon-btn" title="切换主题" onClick={onToggleTheme}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
