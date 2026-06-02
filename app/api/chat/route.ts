import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

const LANGUAGE_LABELS: Record<string, string> = {
  es: '西班牙语',
  en: '英语',
  pt: '葡萄牙语',
  id: '印尼语',
  vi: '越南语',
  th: '泰语',
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

function normalizeSourceLang(value: unknown) {
  const lang = typeof value === 'string' ? value.trim().toLowerCase() : 'es';
  return LANGUAGE_LABELS[lang] ? lang : 'es';
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let body: {
    question?: unknown;
    history?: unknown;
    subtitles?: unknown;
    sourceLang?: unknown;
    analysis?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return error(400, 'missing_question');
  }

  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    return error(400, 'missing_question');
  }

  const subtitles = Array.isArray(body.subtitles) ? body.subtitles as Subtitle[] : [];
  const history = Array.isArray(body.history) ? body.history.filter((m): m is Message => {
    return (
      m &&
      typeof m === 'object' &&
      ((m as Message).role === 'user' || (m as Message).role === 'assistant') &&
      typeof (m as Message).content === 'string'
    );
  }) : [];

  const transcript = subtitles.map((s) => `[${s.t}] ${s.es} / ${s.zh}`).join('\n');
  const sourceLang = normalizeSourceLang(body.sourceLang);
  const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? '原始语言';

  let res: Response;
  try {
    res = await fetch(`${process.env.ANALYSIS_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.ANALYSIS_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANALYSIS_MODEL ?? 'claude-sonnet-4-6',
        messages: [
          {
            role: 'system',
            content: `你是一位专业的 TikTok 带货话术分析师。请基于字幕和已完成的分析回答用户追问，字幕格式为「时间 ${sourceLabel}原文 / 中文翻译」。回复中文，直接给结论。\n\n字幕：\n${transcript}\n\n分析结果：\n${JSON.stringify(body.analysis ?? {})}`,
          },
          ...history,
          { role: 'user', content: body.question.trim() },
        ],
      }),
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'llm_failed', err instanceof Error ? err.message : undefined);
  }

  if (!res.ok) {
    return error(502, 'llm_failed', `LLM status ${res.status}`);
  }

  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content;
  return json({ answer: typeof answer === 'string' ? answer : '' });
}
