import { verifyJWT } from '@/lib/auth';
import type { AnalysisMeta, AnalyzeResponse } from '@/lib/types';
import {
  getValidAnalysisTestVideoUrl,
  getValidPublicAppOrigin,
  prepareServerTmpVideo,
  scheduleTmpVideoDelete,
  TmpVideoError,
  type PreparedVideoInput,
  type VideoFallbackReason,
  type VideoInputMode,
} from '@/lib/tmpVideo';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Subtitle = {
  t: number;
  es: string;
  zh: string;
};

type AnalyzeRequestBody = {
  subtitles?: unknown;
  sourceLang?: unknown;
  videoUrls?: unknown;
  videoIndex?: unknown;
  durationSec?: unknown;
};

type MessageContent =
  | string
  | Array<
    | {
      type: 'video_url';
      video_url: { url: string };
      fps: number;
    }
    | {
      type: 'text';
      text: string;
    }
  >;

const LANGUAGE_LABELS: Record<string, string> = {
  es: '西班牙语',
  en: '英语',
  pt: '葡萄牙语',
  id: '印尼语',
  vi: '越南语',
  th: '泰语',
};

const SCORE_DIMS = ['说服力', '钩子强度', '爆款潜力', '转化引导', '视觉演示'];

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

function sanitizeLogText(value: unknown) {
  return String(value)
    .replace(/token=[^&\s"']+/gi, 'token=[redacted]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]');
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

function getDurationSec(value: unknown) {
  const duration = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function formatTime(seconds: unknown) {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function buildTranscript(subtitles: Subtitle[]) {
  return subtitles
    .map((s) => `[${formatTime(s.t)}] ${s.es} / ${s.zh}`)
    .join('\n');
}

function buildPrompt(options: {
  sourceLabel: string;
  transcript: string;
  durationSec: number;
  hasVideo: boolean;
}) {
  const modeInstruction = options.hasVideo
    ? '你收到了视频和字幕。必须结合画面、镜头、产品出现方式、视觉演示和字幕话术分析，不要只分析字幕。'
    : '你没有收到可用视频。必须基于字幕时间轴完成分析，不能声称看到了画面；视觉演示评分应保守。';

  return `用户是国内电商从业者，目标是拆解海外 TikTok 带货视频。
${modeInstruction}

字幕格式为「时间 ${options.sourceLabel}原文 / 中文翻译」。
视频时长参考：${options.durationSec > 0 ? `${Math.round(options.durationSec)} 秒` : '未知'}。

字幕：
${options.transcript}

请只输出 JSON，不要输出 Markdown、解释或代码块。JSON 必须符合以下结构和要求：
{
  "overall": { "score": 8.7, "label": "高复制价值" },
  "duration": { "label": "短视频最优区间" },
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "scores": [
    { "dim": "说服力", "val": 8.7, "pct": 87 },
    { "dim": "钩子强度", "val": 9.2, "pct": 92 },
    { "dim": "爆款潜力", "val": 8.1, "pct": 81 },
    { "dim": "转化引导", "val": 8.8, "pct": 88 },
    { "dim": "视觉演示", "val": 9.0, "pct": 90 }
  ],
  "videoStructure": [
    { "title": "强钩子开场", "time": "0:00-0:05", "desc": "画面/话术做了什么，以及为什么有效。", "tags": ["好奇心缺口", "结果前置"] }
  ],
  "hooks": [
    { "time": "0:00", "src": "原语言字幕或视频话术", "zh": "中文翻译", "tag": "⚡ 开场钩子 - 好奇心缺口" }
  ],
  "templates": [
    { "type": "开场模板", "text": "说真的，自从用了 [产品]，我家就再也没 [旧的麻烦做法] 过了。" }
  ],
  "summary": "100-200 字中文摘要。",
  "suggestedQuestions": ["追问1", "追问2", "追问3"],
  "meta": {
    "analysisMode": "${options.hasVideo ? 'video_text' : 'text_only'}",
    "videoInputMode": "${options.hasVideo ? 'server_tmp_url' : 'none'}",
    "videoObserved": ${options.hasVideo ? 'true' : 'false'},
    "videoFallbackReason": null
  }
}

字段数量要求：
- sellingPoints 返回 3-5 条。
- scores 固定返回 5 维，顺序必须是：说服力、钩子强度、爆款潜力、转化引导、视觉演示。
- videoStructure 返回 4-6 段，覆盖完整时间线；desc 必须说明画面/话术做了什么以及为什么有效。
- hooks 返回 4-6 条，按时间顺序；src 必须来自原语言字幕或视频话术，不要编造；zh 必须是中文翻译。
- templates 返回 4 条，覆盖开场、演示、结果、收口；text 用 [方括号] 标注可替换槽位。
- suggestedQuestions 返回 3 条。
- 如果你能基于视频画面进行观察，meta.videoObserved 返回 true。
- 如果没有收到视频、无法读取视频、只能基于字幕分析，meta.videoObserved 返回 false。
- 不确定是否看到了视频时，meta.videoObserved 返回 false。
- 如果视频不可见但有字幕，仍然完成结构化分析，并降低“视觉演示”评分。
- text-only 模式下 videoStructure 必须基于字幕时间轴描述，不能声称看到画面。`;
}

function buildMessages(prompt: string, videoUrl: string | null): { role: string; content: MessageContent }[] {
  const system = {
    role: 'system',
    content: '你是一位专业的 TikTok 带货视频分析师，只输出 JSON。',
  };

  if (!videoUrl) {
    return [
      system,
      { role: 'user', content: prompt },
    ];
  }

  return [
    system,
    {
      role: 'user',
      content: [
        {
          type: 'video_url',
          video_url: { url: videoUrl },
          fps: 2,
        },
        {
          type: 'text',
          text: prompt,
        },
      ],
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasCoreFields(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.sellingPoints) &&
    Array.isArray(value.scores) &&
    typeof value.summary === 'string' &&
    Array.isArray(value.suggestedQuestions)
  );
}

function normalizeStringArray(value: unknown, max: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, max)
    : [];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function computeOverall(scores: AnalyzeResponse['scores']) {
  if (scores.length === 0) return { score: 0, label: '可参考' };
  const score = round1(scores.reduce((sum, item) => sum + item.val, 0) / scores.length);
  const label = score >= 8.5 ? '高复制价值' : score >= 7 ? '有复制价值' : '可参考';
  return { score, label };
}

function computeDurationLabel(durationSec: number) {
  if (!durationSec) return '—';
  if (durationSec <= 60) return '短视频最优区间';
  if (durationSec <= 180) return '中等时长';
  return '长视频，建议精简';
}

function normalizeScores(value: unknown, clampVisual: boolean): AnalyzeResponse['scores'] {
  const rawScores = Array.isArray(value) ? value.filter(isRecord) : [];
  const numericVals = rawScores
    .map((item) => clampNumber(item.val, 0, 10, Number.NaN))
    .filter((item) => Number.isFinite(item));
  const fallbackVal = numericVals.length > 0
    ? round1(numericVals.reduce((sum, item) => sum + item, 0) / numericVals.length)
    : 0;

  return SCORE_DIMS.map((dim, index) => {
    const byDim = rawScores.find((item) => item.dim === dim);
    const source = byDim ?? rawScores[index] ?? {};
    let val = round1(clampNumber(source.val, 0, 10, fallbackVal));
    let pct = Math.round(clampNumber(source.pct, 0, 100, val * 10));

    if (clampVisual && dim === '视觉演示') {
      val = Math.min(val, 6.5);
      pct = Math.min(pct, 65);
    }

    return { dim, val, pct };
  });
}

function normalizeVideoStructure(value: unknown): AnalyzeResponse['videoStructure'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    title: typeof item.title === 'string' ? item.title : '',
    time: typeof item.time === 'string' ? item.time : '',
    desc: typeof item.desc === 'string' ? item.desc : '',
    tags: normalizeStringArray(item.tags, 3),
  })).filter((item) => item.title || item.desc).slice(0, 6);
}

function normalizeHooks(value: unknown): AnalyzeResponse['hooks'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    time: typeof item.time === 'string' ? item.time : '',
    src: typeof item.src === 'string' ? item.src : '',
    zh: typeof item.zh === 'string' ? item.zh : '',
    tag: typeof item.tag === 'string' ? item.tag : '',
  })).filter((item) => item.src || item.zh).slice(0, 6);
}

function normalizeTemplates(value: unknown): AnalyzeResponse['templates'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    type: typeof item.type === 'string' ? item.type : '',
    text: typeof item.text === 'string' ? item.text : '',
  })).filter((item) => item.text).slice(0, 4);
}

function normalizeAnalysis(
  raw: unknown,
  options: {
    durationSec: number;
    analysisMode: AnalysisMeta['analysisMode'];
    videoInputMode: VideoInputMode;
    videoObserved: boolean;
    videoFallbackReason: VideoFallbackReason | null;
  },
): AnalyzeResponse {
  const data = isRecord(raw) ? raw : {};
  const scores = normalizeScores(data.scores, options.analysisMode === 'text_only');
  const fallbackOverall = computeOverall(scores);
  const rawOverall = isRecord(data.overall) ? data.overall : {};
  const rawDuration = isRecord(data.duration) ? data.duration : {};

  const meta: AnalysisMeta = {
    analysisMode: options.analysisMode,
    videoInputMode: options.videoInputMode,
    videoObserved: options.analysisMode === 'video_text' && options.videoObserved,
    videoFallbackReason: options.videoFallbackReason,
  };

  return {
    overall: {
      score: round1(clampNumber(rawOverall.score, 0, 10, fallbackOverall.score)),
      label: typeof rawOverall.label === 'string' && rawOverall.label.trim()
        ? rawOverall.label.trim()
        : fallbackOverall.label,
    },
    duration: {
      label: typeof rawDuration.label === 'string' && rawDuration.label.trim()
        ? rawDuration.label.trim()
        : computeDurationLabel(options.durationSec),
    },
    sellingPoints: normalizeStringArray(data.sellingPoints, 5),
    scores,
    videoStructure: normalizeVideoStructure(data.videoStructure),
    hooks: normalizeHooks(data.hooks),
    templates: normalizeTemplates(data.templates),
    summary: typeof data.summary === 'string' ? data.summary.trim() : '',
    suggestedQuestions: normalizeStringArray(data.suggestedQuestions, 3),
    meta,
  };
}

async function requestAnalysis(options: {
  prompt: string;
  videoUrl: string | null;
}) {
  const baseUrl = getRequiredEnv('ANALYSIS_VIDEO_BASE_URL').replace(/\/$/, '');
  const apiKey = getRequiredEnv('ANALYSIS_VIDEO_API_KEY');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANALYSIS_VIDEO_MODEL ?? 'qwen3.7-plus',
      messages: buildMessages(options.prompt, options.videoUrl),
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(await readUpstreamError(res));
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    const err = new Error('missing content');
    err.name = 'AnalysisParseError';
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseAnalysis(content);
  } catch (err) {
    const parseErr = new Error(err instanceof Error ? err.message : 'analysis JSON parse failed');
    parseErr.name = 'AnalysisParseError';
    throw parseErr;
  }

  if (!hasCoreFields(parsed)) {
    const err = new Error('analysis response missing core fields');
    err.name = 'AnalysisParseError';
    throw err;
  }

  return parsed;
}

async function selectVideoInput(body: AnalyzeRequestBody): Promise<{
  input: PreparedVideoInput | null;
  fallbackReason: VideoFallbackReason | null;
}> {
  const testVideo = getValidAnalysisTestVideoUrl();
  if (testVideo.url) {
    return {
      input: { url: testVideo.url, mode: 'test_url' },
      fallbackReason: null,
    };
  }
  if (testVideo.reason) {
    return { input: null, fallbackReason: testVideo.reason };
  }

  if (!Array.isArray(body.videoUrls) || body.videoUrls.length === 0) {
    return { input: null, fallbackReason: 'no_video_input' };
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
      console.error('[analyze] tmp video preparation failed:', sanitizeLogText(err.message));
      return { input: null, fallbackReason: err.reason };
    }
    console.error('[analyze] tmp video preparation failed:', sanitizeLogText(err));
    return { input: null, fallbackReason: 'tmp_video_url_unavailable' };
  }
}

export async function POST(req: Request) {
  try {
    await verifyJWT(req);
  } catch (err) {
    return error(401, 'unauthorized', err instanceof Error ? err.message : undefined);
  }

  let body: AnalyzeRequestBody;
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
  const transcript = buildTranscript(subtitles);
  const durationSec = getDurationSec(body.durationSec);
  const prepared = await selectVideoInput(body);
  let fallbackReason = prepared.fallbackReason;
  let attemptedVideoMode: VideoInputMode = prepared.input?.mode ?? 'none';

  try {
    if (prepared.input) {
      const videoPrompt = buildPrompt({
        sourceLabel,
        transcript,
        durationSec,
        hasVideo: true,
      });

      try {
        const raw = await requestAnalysis({
          prompt: videoPrompt,
          videoUrl: prepared.input.url,
        });
        const rawMeta = isRecord(raw) && isRecord(raw.meta) ? raw.meta : {};
        const videoObserved = rawMeta.videoObserved === true;

        return json(normalizeAnalysis(raw, {
          durationSec,
          analysisMode: videoObserved ? 'video_text' : 'text_only',
          videoInputMode: prepared.input.mode,
          videoObserved,
          videoFallbackReason: videoObserved ? null : 'qwen_video_not_observed',
        }));
      } catch (err) {
        fallbackReason = err instanceof Error && err.name === 'AnalysisParseError'
          ? 'qwen_video_json_parse_failed'
          : 'qwen_video_failed';
        console.error('[analyze] video analysis failed:', sanitizeLogText(err));
      }
    }

    const textPrompt = buildPrompt({
      sourceLabel,
      transcript,
      durationSec,
      hasVideo: false,
    });

    const raw = await requestAnalysis({
      prompt: textPrompt,
      videoUrl: null,
    });

    return json(normalizeAnalysis(raw, {
      durationSec,
      analysisMode: 'text_only',
      videoInputMode: attemptedVideoMode,
      videoObserved: false,
      videoFallbackReason: fallbackReason,
    }));
  } catch (err) {
    console.error('[analyze] text analysis failed:', sanitizeLogText(err));
    if (err instanceof Error && err.name === 'AnalysisParseError') {
      return error(500, 'analysis_parse_failed');
    }
    return error(502, 'llm_failed');
  } finally {
    scheduleTmpVideoDelete(prepared.input?.tmpVideoId);
    attemptedVideoMode = 'none';
  }
}
