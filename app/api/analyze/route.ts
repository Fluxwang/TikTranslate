// POST /api/analyze —— 把整段字幕（可能再加上一段临时托管的视频）交给多模态 LLM，
// 返回结构化的分析结果。
//
// 这个文件只负责编排，三件事分给了三个模块：
//   - lib/analysis-prompt.ts  prompt 与 messages 的构造
//   - lib/analysis-schema.ts  LLM 脏输出的解析与规范化
//   - lib/tmpVideo.ts         把 CDN 视频落到本地临时文件并给出带 token 的公网 URL
//
// 核心策略是「两段式降级」：优先「视频 + 字幕」分析，任何一步失败
// （视频下载失败 / LLM 报错 / JSON 解析失败）都不直接报错给用户，
// 而是静默退回「纯字幕」分析再试一次，两次都失败才返回错误。

import { error, json, unauthorized } from "@/lib/api-error";
import { buildMessages, buildPrompt, buildTranscript } from "@/lib/analysis-prompt";
import { hasCoreFields, isRecord, normalizeAnalysis, parseAnalysis } from "@/lib/analysis-schema";
import { verifyJWT } from "@/lib/auth";
import { getRequiredEnv } from "@/lib/env";
import { sanitizeLogText } from "@/lib/log";
import type { Subtitle } from "@/lib/types";
import {
  getValidAnalysisTestVideoUrl,
  getValidPublicAppOrigin,
  prepareServerTmpVideo,
  scheduleTmpVideoDelete,
  TmpVideoError,
  type PreparedVideoInput,
  type VideoFallbackReason,
  type VideoInputMode,
} from "@/lib/tmpVideo";

export const runtime = "nodejs";
export const maxDuration = 120;

type AnalyzeRequestBody = {
  subtitles?: unknown;
  videoUrls?: unknown;
  videoIndex?: unknown;
  durationSec?: unknown;
};

async function readUpstreamError(res: Response) {
  const text = await res.text().catch(() => "");
  return text ? `LLM status ${res.status}: ${text.slice(0, 1000)}` : `LLM status ${res.status}`;
}

function getDurationSec(value: unknown) {
  const duration = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * 调用上游 LLM 并返回已确认「结构可用」的原始对象。
 *
 * 用 err.name 标记错误类型（而不是自定义 Error 子类），POST() 里靠这个 name
 * 区分「JSON 解析失败」和「请求本身失败」，从而给出不同的降级原因码。
 */
async function requestAnalysis(options: { prompt: string; videoUrl: string | null }) {
  const baseUrl = getRequiredEnv("ANALYSIS_VIDEO_BASE_URL").replace(/\/$/, "");
  const apiKey = getRequiredEnv("ANALYSIS_VIDEO_API_KEY");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANALYSIS_VIDEO_MODEL ?? "qwen3.7-plus",
      messages: buildMessages(options.prompt, options.videoUrl),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(await readUpstreamError(res));
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw parseError("missing content");
  }

  let parsed: unknown;
  try {
    parsed = parseAnalysis(content);
  } catch (err) {
    throw parseError(err instanceof Error ? err.message : "analysis JSON parse failed");
  }

  if (!hasCoreFields(parsed)) {
    throw parseError("analysis response missing core fields");
  }

  return parsed;
}

function parseError(message: string) {
  const err = new Error(message);
  err.name = "AnalysisParseError";
  return err;
}

function isParseError(err: unknown) {
  return err instanceof Error && err.name === "AnalysisParseError";
}

/**
 * 决定这次分析用哪个视频输入。
 *
 * 优先级：ANALYSIS_TEST_VIDEO_URL（本地联调用的固定视频）> 把 TikTok CDN 视频
 * 下载到服务端临时目录再暴露成带 token 的公网 URL > 没有视频（纯字幕模式）。
 *
 * 任何一步失败都不抛错，而是返回 fallbackReason——调用方据此走纯字幕分析，
 * 并把原因透传给前端展示（用户需要知道为什么这次没有画面分析）。
 */
async function selectVideoInput(body: AnalyzeRequestBody): Promise<{
  input: PreparedVideoInput | null;
  fallbackReason: VideoFallbackReason | null;
}> {
  const testVideo = getValidAnalysisTestVideoUrl();
  if (testVideo.url) {
    return {
      input: { url: testVideo.url, mode: "test_url" },
      fallbackReason: null,
    };
  }
  if (testVideo.reason) {
    return { input: null, fallbackReason: testVideo.reason };
  }

  if (!Array.isArray(body.videoUrls) || body.videoUrls.length === 0) {
    return { input: null, fallbackReason: "no_video_input" };
  }

  const publicOrigin = getValidPublicAppOrigin();
  if (!publicOrigin.origin) {
    return { input: null, fallbackReason: publicOrigin.reason };
  }

  try {
    return {
      input: await prepareServerTmpVideo(body.videoUrls, body.videoIndex, publicOrigin.origin),
      fallbackReason: null,
    };
  } catch (err) {
    if (err instanceof TmpVideoError) {
      console.error("[analyze] tmp video preparation failed:", sanitizeLogText(err.message));
      return { input: null, fallbackReason: err.reason };
    }
    console.error("[analyze] tmp video preparation failed:", sanitizeLogText(err));
    return { input: null, fallbackReason: "tmp_video_url_unavailable" };
  }
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return unauthorized(err);
  }

  let body: AnalyzeRequestBody;
  try {
    body = await req.json();
  } catch {
    return error(400, "missing_subtitles");
  }

  if (!Array.isArray(body.subtitles) || body.subtitles.length === 0) {
    return error(400, "missing_subtitles");
  }

  const subtitles = body.subtitles as Subtitle[];
  const transcript = buildTranscript(subtitles);
  const durationSec = getDurationSec(body.durationSec);
  const prepared = await selectVideoInput(body);
  let fallbackReason = prepared.fallbackReason;
  const attemptedVideoMode: VideoInputMode = prepared.input?.mode ?? "none";

  try {
    if (prepared.input) {
      try {
        const raw = await requestAnalysis({
          prompt: buildPrompt({ transcript, durationSec, hasVideo: true }),
          videoUrl: prepared.input.url,
        });

        // 是否真的"看到了视频"以模型自己在 meta.videoObserved 里的自述为准，
        // 而不是"我们发了视频过去"就认定——模型可能因为各种原因实际没能读取视频画面
        const rawMeta = isRecord(raw) && isRecord(raw.meta) ? raw.meta : {};
        const videoObserved = rawMeta.videoObserved === true;

        return json(
          normalizeAnalysis(raw, {
            durationSec,
            analysisMode: videoObserved ? "video_text" : "text_only",
            videoInputMode: prepared.input.mode,
            videoObserved,
            videoFallbackReason: videoObserved ? null : "qwen_video_not_observed",
          }),
        );
      } catch (err) {
        fallbackReason = isParseError(err) ? "qwen_video_json_parse_failed" : "qwen_video_failed";
        console.error("[analyze] video analysis failed:", sanitizeLogText(err));
      }
    }

    const raw = await requestAnalysis({
      prompt: buildPrompt({ transcript, durationSec, hasVideo: false }),
      videoUrl: null,
    });

    return json(
      normalizeAnalysis(raw, {
        durationSec,
        analysisMode: "text_only",
        videoInputMode: attemptedVideoMode,
        videoObserved: false,
        videoFallbackReason: fallbackReason,
      }),
    );
  } catch (err) {
    console.error("[analyze] text analysis failed:", sanitizeLogText(err));
    if (isParseError(err)) {
      return error(500, "analysis_parse_failed");
    }
    return error(502, "llm_failed");
  } finally {
    // 视频文件在分析结束后延迟删除（而不是立即删）：上游可能还在异步拉取，
    // 立刻 unlink 会让尚未读完的请求失败。具体延迟见 lib/tmpVideo.ts。
    scheduleTmpVideoDelete(prepared.input?.tmpVideoId);
  }
}
