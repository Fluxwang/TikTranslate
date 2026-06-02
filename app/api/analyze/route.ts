import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

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

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function readUpstreamError(res: Response) {
  const text = await res.text().catch(() => '');
  return text ? `LLM status ${res.status}: ${text.slice(0, 1000)}` : `LLM status ${res.status}`;
}

function parseAnalysis(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/{[\s\S]*}/);
    if (!match) throw new Error('no json object found');
    return JSON.parse(match[0]);
  }
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

  let body: { subtitles?: unknown; sourceLang?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, 'missing_subtitles');
  }

  if (!Array.isArray(body.subtitles) || body.subtitles.length === 0) {
    return error(400, 'missing_subtitles');
  }

  const subtitles = body.subtitles as Subtitle[];
  const sourceLang = normalizeSourceLang(body.sourceLang);
  const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? '原始语言';
  const transcript = subtitles
    .map((s) => `[${s.t}] ${s.es} / ${s.zh}`)
    .join('\n');

  let res: Response;
  try {
    const baseUrl = getRequiredEnv('ANALYSIS_BASE_URL').replace(/\/$/, '');
    const apiKey = getRequiredEnv('ANALYSIS_API_KEY');

    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANALYSIS_MODEL ?? 'claude-sonnet-4-6',
        messages: [
          {
            role: 'system',
            content: `你是一位专业的 TikTok 带货话术分析师，服务于国内电商从业者。用户会提供一段 TikTok 视频的完整字幕（${sourceLabel}原文 + 中文翻译），你需要分析达人的带货话术并返回结构化 JSON，不要输出任何 JSON 以外的内容。`,
          },
          {
            role: 'user',
            content: `以下是视频字幕：\n${transcript}\n\n请按以下 JSON 格式输出分析结果：\n{\n  "sellingPoints": ["卖点1", "卖点2"],\n  "scores": [\n    { "dim": "说服力", "val": 0, "pct": 0 },\n    { "dim": "钩子强度", "val": 0, "pct": 0 },\n    { "dim": "爆款潜力", "val": 0, "pct": 0 }\n  ],\n  "summary": "100-200字的话术摘要，重点分析开场钩子、实证方式、收口转化",\n  "suggestedQuestions": ["追问1", "追问2", "追问3"]\n}`,
          },
        ],
      }),
      cache: 'no-store',
    });
  } catch (err) {
    return error(502, 'llm_failed', err instanceof Error ? err.message : undefined);
  }

  if (!res.ok) {
    return error(502, 'llm_failed', await readUpstreamError(res));
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return error(500, 'analysis_parse_failed', 'missing content');
  }

  try {
    return json(parseAnalysis(content));
  } catch (err) {
    return error(500, 'analysis_parse_failed', err instanceof Error ? err.message : undefined);
  }
}
