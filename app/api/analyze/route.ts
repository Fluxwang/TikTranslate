import { verifyJWT } from '@/lib/auth';

export const maxDuration = 60;

type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, status);
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

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let body: { subtitles?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, 'missing_subtitles');
  }

  if (!Array.isArray(body.subtitles) || body.subtitles.length === 0) {
    return error(400, 'missing_subtitles');
  }

  const subtitles = body.subtitles as Subtitle[];
  const transcript = subtitles
    .map((s) => `[${s.t}] ${s.es} / ${s.zh}`)
    .join('\n');

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
            content: '你是一位专业的 TikTok 带货话术分析师，服务于国内电商从业者。用户会提供一段 TikTok 视频的完整字幕（西语原文 + 中文翻译），你需要分析达人的带货话术并返回结构化 JSON，不要输出任何 JSON 以外的内容。',
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
    return error(502, 'llm_failed', `LLM status ${res.status}`);
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
