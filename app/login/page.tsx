'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (window.localStorage.getItem('tt_token')) {
      router.replace('/');
    }
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || pending) return;

    setPending(true);
    setMessage('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json() as { token: string };
        window.localStorage.setItem('tt_token', data.token);
        router.replace('/');
        return;
      }

      setMessage(res.status === 429 ? '尝试次数过多，请稍后再试' : '密码错误');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-box" onSubmit={onSubmit}>
        <div className="brand login-brand">
          <span className="mark">T</span>
          <b>TikTranslate</b>
        </div>
        <label className="login-label" htmlFor="password">访问密码</label>
        <input
          id="password"
          className="login-input"
          type="password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
        {message && <div className="login-error">{message}</div>}
        <button className="btn btn-primary login-submit" disabled={!password || pending}>
          {pending ? <><span className="spinner" /> 登录中</> : '登录'}
        </button>
      </form>
    </main>
  );
}
