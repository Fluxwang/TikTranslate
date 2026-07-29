import { error, json, unauthorized } from "@/lib/api-error";
import { verifyJWT } from "@/lib/auth";

export const maxDuration = 60; // Next.js 路由级配置：Serverless 函数最长执行时间（秒），非普通常量

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return unauthorized(err);
  }

  let body: {
    question?: unknown;
    history?: unknown;
    subtitles?: unknown;
    analysis?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return error(400, "missing_question");
  }

  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return error(400, "missing_question");
  }

  const subtitles = Array.isArray(body.subtitles) ? (body.subtitles as Subtitle[]) : [];
  const history = Array.isArray(body.history)
    ? body.history.filter((m): m is Message => {
        return (
          m &&
          typeof m === "object" &&
          ((m as Message).role === "user" || (m as Message).role === "assistant") &&
          typeof (m as Message).content === "string"
        );
      })
    : [];

  const transcript = subtitles.map((s) => `[${s.t}] ${s.es} / ${s.zh}`).join("\n");

  let res: Response;
  try {
    res = await fetch(`${process.env.ANALYSIS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ANALYSIS_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANALYSIS_MODEL ?? "claude-sonnet-4-6",
        messages: [
          {
            role: "system",
            // 注意：body.analysis 是客户端直接传来的数据，未经校验就原样塞进了 system prompt
            content: `你是一位专业的 TikTok 带货话术分析师。请基于字幕和已完成的分析回答用户追问，字幕格式为「时间 原文 / 中文翻译」。回复中文，直接给结论。\n\n字幕：\n${transcript}\n\n分析结果：\n${JSON.stringify(body.analysis ?? {})}`,
          },
          ...history,
          { role: "user", content: body.question.trim() },
        ],
      }),
      cache: "no-store",
    });
  } catch (err) {
    return error(502, "llm_failed", err instanceof Error ? err.message : undefined);
  }

  if (!res.ok) {
    return error(502, "llm_failed", `LLM status ${res.status}`);
  }

  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content;
  return json({ answer: typeof answer === "string" ? answer : "" });
}
