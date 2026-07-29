// LLM 分析结果的解析与规范化层。
//
// 这一层存在的理由：/api/analyze 的上游是大模型，它的输出是「大概率符合约定、
// 但随时可能不符合」的 JSON——字段缺失、类型不对、数值越界、数组超长、
// 甚至在 JSON 外面裹一层解释文字，都真实发生过。
//
// 因此前端拿到的每一个字段都必须先经过这里：所有 normalize* 函数都保证
// 「无论输入多脏，输出一定是 AnalyzeResponse 声明的形状」，前端不再判空。
//
// 这些函数全部是纯函数、无副作用、不读环境变量，因此可以直接单测
// （见 lib/analysis-schema.test.ts）——这也是把它们从 route handler 里
// 抽出来的主要动机：留在 route 里既不能 export 也就无法测试。

import type { AnalysisMeta, AnalyzeResponse } from "./types";
import type { VideoFallbackReason, VideoInputMode } from "./tmpVideo";

// 这 5 个维度名必须和 lib/analysis-prompt.ts 里 JSON 示例中的 scores 顺序、
// 以及前端展示逻辑保持一致——改名字要三处一起改
export const SCORE_DIMS = ["说服力", "钩子强度", "爆款潜力", "转化引导", "视觉演示"];

/** 纯文本模式下「视觉演示」这一维的封顶值，见 normalizeScores。 */
const VISUAL_SCORE_CAP = 6.5;

export function parseAnalysis(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    // LLM 有时不会严格按“只输出 JSON”的指令来，会在前后加解释文字或 Markdown 代码块，
    // 这里兜底从文本里抠出第一个 {...} 块再解析一次
    const match = content.match(/{[\s\S]*}/);
    if (!match) throw new Error("no json object found");
    return JSON.parse(match[0]);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 判断 LLM 返回的对象是否具备最核心的四个字段。
 *
 * 只检查这四个而不是全量校验：核心字段缺失说明模型整体跑偏了，应该走降级重试；
 * 而次要字段（videoStructure/hooks/templates）缺失是可以接受的，
 * 由下面的 normalize* 补成空数组即可，没必要为此丢弃整份结果。
 */
export function hasCoreFields(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.sellingPoints) &&
    Array.isArray(value.scores) &&
    typeof value.summary === "string" &&
    Array.isArray(value.suggestedQuestions)
  );
}

export function normalizeStringArray(value: unknown, max: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, max)
    : [];
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function computeOverall(scores: AnalyzeResponse["scores"]) {
  if (scores.length === 0) return { score: 0, label: "可参考" };
  const score = round1(scores.reduce((sum, item) => sum + item.val, 0) / scores.length);
  // 8.5 / 7 是评级等级的经验阈值，与 lib/analysis.ts 前端侧的同名函数保持一致
  const label = score >= 8.5 ? "高复制价值" : score >= 7 ? "有复制价值" : "可参考";
  return { score, label };
}

export function computeDurationLabel(durationSec: number) {
  if (!durationSec) return "—";
  if (durationSec <= 60) return "短视频最优区间";
  if (durationSec <= 180) return "中等时长";
  return "长视频，建议精简";
}

/**
 * 把 LLM 返回的 scores 规范成固定 5 维、固定顺序。
 *
 * 匹配策略是「先按 dim 名字找，找不到再按下标兜底」：模型偶尔会漏一维或改写维度名，
 * 按下标兜底至少能保住数值不丢。两者都没有时用其余维度的均值填充，
 * 而不是填 0——填 0 会让整体评分被异常拉低，比略微不准更具误导性。
 *
 * @param clampVisual 纯文本模式传 true，见下方视觉演示封顶逻辑
 */
export function normalizeScores(value: unknown, clampVisual: boolean): AnalyzeResponse["scores"] {
  const rawScores = Array.isArray(value) ? value.filter(isRecord) : [];
  const numericVals = rawScores
    .map((item) => clampNumber(item.val, 0, 10, Number.NaN))
    .filter((item) => Number.isFinite(item));
  const fallbackVal =
    numericVals.length > 0
      ? round1(numericVals.reduce((sum, item) => sum + item, 0) / numericVals.length)
      : 0;

  return SCORE_DIMS.map((dim, index) => {
    const byDim = rawScores.find((item) => item.dim === dim);
    const source = byDim ?? rawScores[index] ?? {};
    let val = round1(clampNumber(source.val, 0, 10, fallbackVal));
    let pct = Math.round(clampNumber(source.pct, 0, 100, val * 10));

    // 业务规则：纯文本模式下模型根本没看到画面，不能让它给"视觉演示"打高分，
    // 因此强制把这一项的分数封顶，防止误导用户
    if (clampVisual && dim === "视觉演示") {
      val = Math.min(val, VISUAL_SCORE_CAP);
      pct = Math.min(pct, VISUAL_SCORE_CAP * 10);
    }

    return { dim, val, pct };
  });
}

export function normalizeVideoStructure(value: unknown): AnalyzeResponse["videoStructure"] {
  if (!Array.isArray(value)) return [];
  return (
    value
      .filter(isRecord)
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        time: typeof item.time === "string" ? item.time : "",
        desc: typeof item.desc === "string" ? item.desc : "",
        tags: normalizeStringArray(item.tags, 3),
      }))
      // 标题和描述都为空的段落对用户没有任何信息量，直接丢弃而不是渲染成空卡片
      .filter((item) => item.title || item.desc)
      .slice(0, 6)
  );
}

export function normalizeHooks(value: unknown): AnalyzeResponse["hooks"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      time: typeof item.time === "string" ? item.time : "",
      src: typeof item.src === "string" ? item.src : "",
      zh: typeof item.zh === "string" ? item.zh : "",
      tag: typeof item.tag === "string" ? item.tag : "",
    }))
    .filter((item) => item.src || item.zh)
    .slice(0, 6);
}

export function normalizeTemplates(value: unknown): AnalyzeResponse["templates"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      type: typeof item.type === "string" ? item.type : "",
      text: typeof item.text === "string" ? item.text : "",
    }))
    .filter((item) => item.text)
    .slice(0, 4);
}

/**
 * 规范化入口：把 LLM 的原始返回整形成 AnalyzeResponse。
 *
 * meta 里的字段不取模型返回值，一律由调用方（route handler）根据自己掌握的
 * 事实传入——模型对「自己有没有看到视频」的自述只是其中一个输入信号，
 * 最终判定权在服务端，否则模型可以随口声称看过视频。
 */
export function normalizeAnalysis(
  raw: unknown,
  options: {
    durationSec: number;
    analysisMode: AnalysisMeta["analysisMode"];
    videoInputMode: VideoInputMode;
    videoObserved: boolean;
    videoFallbackReason: VideoFallbackReason | null;
  },
): AnalyzeResponse {
  const data = isRecord(raw) ? raw : {};
  const scores = normalizeScores(data.scores, options.analysisMode === "text_only");
  const fallbackOverall = computeOverall(scores);
  const rawOverall = isRecord(data.overall) ? data.overall : {};
  const rawDuration = isRecord(data.duration) ? data.duration : {};

  const meta: AnalysisMeta = {
    analysisMode: options.analysisMode,
    videoInputMode: options.videoInputMode,
    videoObserved: options.analysisMode === "video_text" && options.videoObserved,
    videoFallbackReason: options.videoFallbackReason,
  };

  return {
    overall: {
      score: round1(clampNumber(rawOverall.score, 0, 10, fallbackOverall.score)),
      label:
        typeof rawOverall.label === "string" && rawOverall.label.trim()
          ? rawOverall.label.trim()
          : fallbackOverall.label,
    },
    duration: {
      label:
        typeof rawDuration.label === "string" && rawDuration.label.trim()
          ? rawDuration.label.trim()
          : computeDurationLabel(options.durationSec),
    },
    sellingPoints: normalizeStringArray(data.sellingPoints, 5),
    scores,
    videoStructure: normalizeVideoStructure(data.videoStructure),
    hooks: normalizeHooks(data.hooks),
    templates: normalizeTemplates(data.templates),
    summary: typeof data.summary === "string" ? data.summary.trim() : "",
    suggestedQuestions: normalizeStringArray(data.suggestedQuestions, 3),
    meta,
  };
}
